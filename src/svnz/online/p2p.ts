// Direct connections between the host and the guests (WebRTC data channels). The server is only the matchmaker: it forwards the offer / answer /
// ICE messages ("rtc"). Once a link is open, the controller state (guest -> host) and the snapshots (host -> guest) travel straight between the
// browsers, skipping the round trip through the server (which can be a continent away). If a link cannot be made (strict NATs, no TURN server)
// or breaks, everything keeps working through the server's relay exactly as before.
import { backend } from './config';
import type { NetClient, ServerMessage } from './net';

export async function fetchIceServers(): Promise<RTCIceServer[]> {
  try {
    const r = await fetch(backend.http + '/api/info', { headers: { 'x-svnz-token': backend.token } });
    const j = (await r.json()) as { iceServers?: RTCIceServer[] };
    if (Array.isArray(j.iceServers) && j.iceServers.length) return j.iceServers;
  } catch { /* offline: fall back to a public STUN server */ }
  return [{ urls: 'stun:stun.l.google.com:19302' }];
}

interface Link {
  id: number;
  pc: RTCPeerConnection;
  snap: RTCDataChannel | null;
  inp: RTCDataChannel | null;
  open: boolean;
  /** round trip over this link (guest: measured; host: reported by the guest) */
  rtt: number;
  pending: RTCIceCandidateInit[];
  remoteSet: boolean;
  tries: number;
}

export interface P2POptions {
  net: NetClient;
  me: number;
  hostId: number;
  guests: number[];
  iceServers: RTCIceServer[];
  /** host: a guest's controller state came in */
  onInput?: (from: number, d: unknown) => void;
  /** guest: a snapshot came in */
  onSnap?: (d: unknown) => void;
}

export class P2P {
  private links = new Map<number, Link>();
  private off: () => void;
  private pingTimer = 0;
  private closed = false;
  readonly isHost: boolean;

  constructor(private o: P2POptions) {
    this.isHost = o.me === o.hostId;
    this.off = o.net.on((m: ServerMessage) => { if (m.t === 'rtc') void this.signal(m.from, m.d as { k: string; s?: string; c?: RTCIceCandidateInit }); });
    if (typeof RTCPeerConnection === 'undefined') { this.closed = true; return; }
    if (!this.isHost) this.connectToHost();
    this.pingTimer = window.setInterval(() => this.ping(), 1000);
  }

  // ---------------------------------------------------------------- queries
  /** host: every guest has an open direct link */
  allOpen(): boolean {
    if (!this.isHost || this.closed) return false;
    return this.o.guests.every((g) => this.links.get(g)?.open);
  }
  /** guest: the link to the host is open */
  get hostLinkOpen(): boolean { return !this.isHost && !!this.links.get(this.o.hostId)?.open; }
  /** round trip (ms) of the direct link of a guest (host side) or to the host (guest side); 0 = no direct link */
  rtt(id?: number): number {
    const l = this.links.get(id ?? (this.isHost ? -1 : this.o.hostId));
    return l?.open ? l.rtt : 0;
  }
  /** host: worst round trip among the guests with a direct link */
  worstRtt(): number { let w = 0; for (const l of this.links.values()) if (l.open) w = Math.max(w, l.rtt); return w; }

  // ---------------------------------------------------------------- sending
  /** host: snapshot (already a JSON string) to every guest with an open link. Returns how many it reached. */
  sendSnap(json: string): number {
    let n = 0;
    for (const l of this.links.values()) {
      if (l.open && l.snap && l.snap.readyState === 'open' && l.snap.bufferedAmount < 64 * 1024) { l.snap.send(json); n++; }
    }
    return n;
  }
  /** guest: controller state to the host. false = no direct link, use the relay. */
  sendInput(d: unknown): boolean {
    const l = this.links.get(this.o.hostId);
    if (!l?.open || !l.inp || l.inp.readyState !== 'open') return false;
    l.inp.send(JSON.stringify({ t: 'in', d }));
    return true;
  }

  // ---------------------------------------------------------------- links
  private newLink(id: number): Link {
    const pc = new RTCPeerConnection({ iceServers: this.o.iceServers });
    const link: Link = { id, pc, snap: null, inp: null, open: false, rtt: 0, pending: [], remoteSet: false, tries: 0 };
    this.links.set(id, link);
    pc.onicecandidate = (e) => { if (e.candidate) this.sig(id, { k: 'ice', c: e.candidate.toJSON() }); };
    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      if (s === 'failed' || s === 'closed' || s === 'disconnected') {
        link.open = false;
        // the guest tries again a couple of times; the relay carries the game meanwhile
        if (!this.isHost && !this.closed && link.tries < 3 && s !== 'closed') {
          const old = link.pc;
          window.setTimeout(() => { if (!this.closed && !this.links.get(id)?.open) { try { old.close(); } catch { /* gone */ } this.connectToHost(link.tries + 1); } }, 4000);
        }
      }
    };
    return link;
  }

  private bind(link: Link, ch: RTCDataChannel): void {
    if (ch.label === 'snap') link.snap = ch; else link.inp = ch;
    ch.onopen = () => { link.open = !!(link.snap?.readyState === 'open' && link.inp?.readyState === 'open'); };
    ch.onclose = () => { link.open = false; };
    ch.onmessage = (ev) => {
      let m: { t: string; d?: unknown; n?: number; pg?: number };
      try { m = JSON.parse(String(ev.data)); } catch { return; }
      if (m.t === 'snap') this.o.onSnap?.(m.d ?? m);
      else if (m.t === 'in') this.o.onInput?.(link.id, m.d);
      else if (m.t === 'ping' && this.isHost) { link.rtt = Math.round(m.pg ?? 0); if (link.inp?.readyState === 'open') link.inp.send(JSON.stringify({ t: 'pong', n: m.n })); }
      else if (m.t === 'pong') link.rtt = Math.round(performance.now() - (m.n ?? performance.now()));
    };
  }

  private connectToHost(tries = 0): void {
    if (this.closed) return;
    const link = this.newLink(this.o.hostId);
    link.tries = tries;
    // snapshots: the newest one is all that matters, so no retransmissions and no ordering; controller state: reliable and ordered
    this.bind(link, link.pc.createDataChannel('snap', { ordered: false, maxRetransmits: 0 }));
    this.bind(link, link.pc.createDataChannel('in', { ordered: true }));
    // the host may not be listening yet (it fetches the STUN servers first): ask again if nobody answered
    window.setTimeout(() => {
      if (!this.closed && this.links.get(this.o.hostId) === link && !link.open && link.tries < 3) {
        try { link.pc.close(); } catch { /* gone */ }
        this.connectToHost(link.tries + 1);
      }
    }, 7000);
    void (async () => {
      try {
        await link.pc.setLocalDescription(await link.pc.createOffer());
        this.sig(this.o.hostId, { k: 'offer', s: link.pc.localDescription?.sdp ?? '' });
      } catch { /* no direct link: the relay is used */ }
    })();
  }

  private async signal(from: number, d: { k: string; s?: string; c?: RTCIceCandidateInit }): Promise<void> {
    if (this.closed) return;
    try {
      if (d.k === 'offer' && this.isHost && d.s) {
        const old = this.links.get(from);
        if (old) { try { old.pc.close(); } catch { /* gone */ } }
        const link = this.newLink(from);
        link.pc.ondatachannel = (e) => this.bind(link, e.channel);
        await link.pc.setRemoteDescription({ type: 'offer', sdp: d.s });
        link.remoteSet = true;
        for (const c of link.pending.splice(0)) await link.pc.addIceCandidate(c).catch(() => undefined);
        await link.pc.setLocalDescription(await link.pc.createAnswer());
        this.sig(from, { k: 'answer', s: link.pc.localDescription?.sdp ?? '' });
      } else if (d.k === 'answer' && !this.isHost && d.s) {
        const link = this.links.get(from);
        if (!link) return;
        await link.pc.setRemoteDescription({ type: 'answer', sdp: d.s });
        link.remoteSet = true;
        for (const c of link.pending.splice(0)) await link.pc.addIceCandidate(c).catch(() => undefined);
      } else if (d.k === 'ice' && d.c) {
        const link = this.links.get(from);
        if (!link) return;
        if (link.remoteSet) await link.pc.addIceCandidate(d.c).catch(() => undefined); else link.pending.push(d.c);
      }
    } catch { /* a failed negotiation just leaves the relay in charge */ }
  }

  private sig(to: number, d: { k: string; s?: string; c?: RTCIceCandidateInit }): void { this.o.net.send({ t: 'rtc', to, d }); }

  private ping(): void {
    if (this.isHost) return;
    const l = this.links.get(this.o.hostId);
    if (l?.open && l.inp?.readyState === 'open') l.inp.send(JSON.stringify({ t: 'ping', n: performance.now(), pg: l.rtt }));
  }

  close(): void {
    this.closed = true;
    window.clearInterval(this.pingTimer);
    this.off();
    for (const l of this.links.values()) { l.open = false; try { l.pc.close(); } catch { /* gone */ } }
    this.links.clear();
  }
}
