// Client of svnz-backend: REST to make / check rooms, one WebSocket for the lobby and for the match.
// Protocol (JSON): see svnz-backend/src/protocol.ts. The host's browser runs the fight and sends snapshots ("snap");
// guests send their controller state ("in"); the server only relays.
//
// Sessions: joining a room gives a secret session id, kept in sessionStorage (it survives a page reload, not a closed tab). If the
// connection drops, or the page is reloaded, the client comes back to the same seat with `resume`; the server keeps the seat for a while.
import { backend } from './config';
import type { FightSettings } from './items';
import type { Difficulty } from './scaling';

export type Mode = 'coop' | 'vs';
export interface RoomPlayer { id: number; name: string; char: string; variant: number; team: number; ready: boolean; host: boolean; online: boolean }
export interface RoomView { code: string; mode: Mode; status: 'lobby' | 'playing'; hostId: number | null; max: number; settings: FightSettings; players: RoomPlayer[]; difficulty: Difficulty }

export type ServerMessage =
  | { t: 'joined'; you: number; host: boolean; sid: string; resumed: boolean; claimed: boolean; room: RoomView }
  | { t: 'room'; room: RoomView }
  | { t: 'start'; room: RoomView; difficulty: Difficulty; you: number }
  | { t: 'in'; from: number; d: unknown }
  | { t: 'snap'; d: unknown }
  | { t: 'ended'; d: unknown }
  | { t: 'left'; id: number }
  | { t: 'peer'; id: number; online: boolean }
  | { t: 'kicked' }
  | { t: 'replaced' }
  | { t: 'closed'; reason: string }
  | { t: 'error'; code: string; msg: string }
  | { t: 'pong'; n: number }
  /** local events: the connection was lost / came back */
  | { t: 'link'; state: 'lost' | 'back' };

export class NetError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

const ERRORS: Record<string, string> = {
  unauthorized: 'El servidor rechazó el token del juego (revisá PUBLIC_SVNZ_BACKEND_TOKEN).',
  forbidden_origin: 'Este sitio no está permitido en el servidor (ALLOWED_ORIGINS).',
  rate_limited: 'Demasiados intentos, esperá un momento.',
  blocked: 'Demasiados intentos fallidos: esperá unos minutos.',
  not_found: 'No existe una sala con ese código.',
  full: 'La sala está llena.',
  started: 'La partida ya empezó y ahí no hay un asiento libre con tu nombre.',
  banned: 'El anfitrión te sacó de esta sala.',
  limit: 'El servidor está lleno, probá más tarde.',
  bad_session: 'La sesión venció.',
  taken: 'Ese color ya lo tiene otro jugador.',
  invalid_request: 'Solicitud inválida.',
};
export const errorText = (code: string, fallback = 'Error de conexión'): string => ERRORS[code] ?? fallback;

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  let r: Response;
  try {
    r = await fetch(backend.http + path, { ...init, headers: { 'content-type': 'application/json', 'x-svnz-token': backend.token } });
  } catch {
    throw new NetError('offline', 'No se pudo conectar con el servidor.');
  }
  const data = (await r.json().catch(() => ({}))) as { error?: string } & T;
  if (!r.ok) throw new NetError(data.error ?? `http_${r.status}`, errorText(data.error ?? '', `Error ${r.status}`));
  return data;
}

/** The lobby needs a backend that speaks protocol 3 or newer (sessions, settings, colours). An old one would send rooms the page cannot read. */
export const REQUIRED_PROTOCOL = 3;
export async function checkServer(): Promise<void> {
  const info = await api<{ protocol?: number }>('/api/info');
  if ((info.protocol ?? 1) < REQUIRED_PROTOCOL) throw new NetError('old_server', 'El servidor del backend está desactualizado: actualizá svnz-backend a la última versión (git pull, npm ci, npm run build y reiniciar).');
}

export const createRoom = (mode: Mode) => api<{ code: string; hostKey: string; mode: Mode; max: number }>('/api/rooms', { method: 'POST', body: JSON.stringify({ mode }) });
export const checkRoom = (code: string) => api<{ code: string; mode: Mode; status: string; players: number; max: number; joinable: boolean }>('/api/rooms/' + encodeURIComponent(code));

// ---------------------------------------------------------------- stored session
const KEY = 'svnz-session';
export interface StoredSession { code: string; sid: string; name: string; t: number }
const SESSION_MAX_AGE = 10 * 60 * 1000;   // the server frees a seat after 45 s by default; this only avoids trying with a very old one

export function storedSession(): StoredSession | null {
  try {
    const s = JSON.parse(sessionStorage.getItem(KEY) ?? 'null') as StoredSession | null;
    if (s && typeof s.code === 'string' && typeof s.sid === 'string' && Date.now() - s.t < SESSION_MAX_AGE) return s;
  } catch { /* storage blocked */ }
  return null;
}
const keep = (s: StoredSession) => { try { sessionStorage.setItem(KEY, JSON.stringify(s)); } catch { /* blocked */ } };
export const forgetSession = () => { try { sessionStorage.removeItem(KEY); } catch { /* blocked */ } };

type Listener = (m: ServerMessage) => void;

export class NetClient {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private pingTimer = 0;
  private pingAt = 0;
  private lastPong = 0;
  private session: StoredSession | null = null;
  private manual = false;
  private retryTimer = 0;
  /** round trip to the server in ms (0 = unknown) */
  rtt = 0;
  you = -1;
  isHost = false;
  room: RoomView | null = null;
  connected = false;
  /** the connection dropped and the client is trying to get its seat back */
  reconnecting = false;

  on(fn: Listener): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private emit(m: ServerMessage): void { for (const l of [...this.listeners]) l(m); }

  private open(first: Record<string, unknown>): Promise<RoomView> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let ws: WebSocket;
      try {
        ws = new WebSocket(backend.ws, ['svnz-v1', 'token.' + backend.token]);
      } catch {
        reject(new NetError('offline', 'No se pudo conectar con el servidor.'));
        return;
      }
      this.ws = ws;
      const fail = (e: NetError) => { if (!settled) { settled = true; reject(e); } };
      ws.onopen = () => {
        this.connected = true;
        this.lastPong = performance.now();
        ws.send(JSON.stringify(first));
        window.clearInterval(this.pingTimer);
        this.pingTimer = window.setInterval(() => {
          // a connection that stopped answering (a proxy dropped it without telling anybody) is replaced by a fresh one with the same seat
          if (performance.now() - this.lastPong > 7000) { this.forceReconnect(); return; }
          this.pingAt = performance.now();
          this.send({ t: 'ping', n: 1 });
        }, 2000);
      };
      ws.onmessage = (ev) => {
        let m: ServerMessage;
        try { m = JSON.parse(String(ev.data)) as ServerMessage; } catch { return; }
        if (m.t === 'pong') { this.lastPong = performance.now(); this.rtt = Math.round(this.lastPong - this.pingAt); return; }
        if (m.t === 'joined') {
          this.you = m.you; this.isHost = m.host; this.room = m.room;
          this.session = { code: m.room.code, sid: m.sid, name: m.room.players.find((p) => p.id === m.you)?.name ?? '', t: Date.now() };
          keep(this.session);
          if (!settled) { settled = true; resolve(m.room); }
        } else if (m.t === 'room' || m.t === 'start') {
          this.room = m.room;
          if (this.session) { this.session.t = Date.now(); keep(this.session); }
        } else if (m.t === 'error' && !settled) fail(new NetError(m.code, errorText(m.code, m.msg)));
        else if (m.t === 'closed' || m.t === 'kicked') { this.session = null; forgetSession(); this.manual = true; }
        this.emit(m);
      };
      ws.onerror = () => fail(new NetError('offline', 'No se pudo conectar con el servidor.'));
      ws.onclose = () => {
        this.connected = false;
        window.clearInterval(this.pingTimer);
        fail(new NetError('closed', 'La conexión se cerró.'));
        if (this.ws !== ws) return;   // a newer socket took over
        if (this.session && !this.manual) this.reconnect();
        else if (!this.manual) this.emit({ t: 'closed', reason: 'disconnected' });
      };
    });
  }

  /** Opens the socket and joins a room. Resolves once the server answered `joined`. */
  connect(code: string, name: string, hostKey?: string): Promise<RoomView> {
    this.close(false);
    this.manual = false;
    return this.open({ t: 'join', code, name, key: hostKey });
  }

  /** Comes back to the seat of a stored session (after a page reload). */
  resume(s: StoredSession): Promise<RoomView> {
    this.close(false);
    this.manual = false;
    this.session = s;
    return this.open({ t: 'resume', code: s.code, sid: s.sid });
  }

  /** Drops the current socket (even if it looks open) and comes back to the seat on a new one. */
  forceReconnect(): void {
    if (!this.session || this.manual || this.reconnecting) return;
    const old = this.ws;
    this.ws = null;
    this.connected = false;
    window.clearInterval(this.pingTimer);
    if (old) { old.onclose = null; old.onerror = null; old.onmessage = null; try { old.close(); } catch { /* already gone */ } }
    this.reconnect();
  }

  /** The socket dropped: try again with the session id (the server keeps the seat for a while). */
  private reconnect(): void {
    if (this.reconnecting || !this.session) return;
    this.reconnecting = true;
    this.emit({ t: 'link', state: 'lost' });
    const started = Date.now();
    let n = 0;
    const attempt = () => {
      const s = this.session;
      if (!s || this.manual) { this.reconnecting = false; return; }
      this.open({ t: 'resume', code: s.code, sid: s.sid }).then(() => {
        this.reconnecting = false;
        this.emit({ t: 'link', state: 'back' });
      }).catch((e: NetError) => {
        if (e.code === 'bad_session' || e.code === 'not_found' || e.code === 'banned' || Date.now() - started > 60_000) {
          this.reconnecting = false;
          this.session = null;
          forgetSession();
          this.manual = true;
          this.emit({ t: 'closed', reason: 'session_lost' });
          return;
        }
        this.retryTimer = window.setTimeout(attempt, Math.min(4000, 400 * 2 ** n++));
      });
    };
    attempt();
  }

  send(m: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  /** Leaves for good (clears the session). */
  close(forget = true): void {
    window.clearInterval(this.pingTimer);
    window.clearTimeout(this.retryTimer);
    this.manual = true;
    this.reconnecting = false;
    const ws = this.ws;
    this.ws = null;
    this.connected = false;
    if (forget) { this.session = null; forgetSession(); }
    if (ws) { ws.onclose = null; ws.onerror = null; ws.onmessage = null; try { ws.close(1000, 'bye'); } catch { /* closed */ } }
  }
}
