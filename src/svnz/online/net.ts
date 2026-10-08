// Client of svnz-backend: REST to make / check rooms, one WebSocket for the lobby and for the match.
// Protocol (JSON): see svnz-backend/src/protocol.ts. The host's browser runs the fight and sends snapshots ("snap");
// guests send their controller state ("in"); the server only relays.
import { backend } from './config';
import type { Difficulty } from './scaling';

export type Mode = 'coop' | 'vs';
export interface RoomPlayer { id: number; name: string; char: string; team: 1 | 2; ready: boolean; host: boolean }
export interface RoomView { code: string; mode: Mode; status: 'lobby' | 'playing'; hostId: number | null; max: number; players: RoomPlayer[]; difficulty: Difficulty }

export type ServerMessage =
  | { t: 'joined'; you: number; host: boolean; room: RoomView }
  | { t: 'room'; room: RoomView }
  | { t: 'start'; room: RoomView; difficulty: Difficulty; you: number }
  | { t: 'in'; from: number; d: unknown }
  | { t: 'snap'; d: unknown }
  | { t: 'ended'; d: unknown }
  | { t: 'left'; id: number }
  | { t: 'closed'; reason: string }
  | { t: 'error'; code: string; msg: string }
  | { t: 'pong'; n: number };

export class NetError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

const ERRORS: Record<string, string> = {
  unauthorized: 'El servidor rechazo el token del juego (revisa PUBLIC_SVNZ_BACKEND_TOKEN).',
  forbidden_origin: 'Este sitio no esta permitido en el servidor (ALLOWED_ORIGINS).',
  rate_limited: 'Demasiados intentos, espera un momento.',
  not_found: 'No existe una sala con ese codigo.',
  full: 'La sala esta llena.',
  started: 'La partida ya empezo.',
  limit: 'El servidor esta lleno, proba mas tarde.',
  invalid_request: 'Solicitud invalida.',
};
export const errorText = (code: string, fallback = 'Error de conexion'): string => ERRORS[code] ?? fallback;

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

export const createRoom = (mode: Mode) => api<{ code: string; hostKey: string; mode: Mode; max: number }>('/api/rooms', { method: 'POST', body: JSON.stringify({ mode }) });
export const checkRoom = (code: string) => api<{ code: string; mode: Mode; status: string; players: number; max: number; joinable: boolean }>('/api/rooms/' + encodeURIComponent(code));

type Listener = (m: ServerMessage) => void;

export class NetClient {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private pingTimer = 0;
  private pingAt = 0;
  /** round trip to the server in ms (0 = unknown) */
  rtt = 0;
  you = -1;
  isHost = false;
  room: RoomView | null = null;
  connected = false;

  on(fn: Listener): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private emit(m: ServerMessage): void { for (const l of [...this.listeners]) l(m); }

  /** Opens the socket and joins a room. Resolves once the server answered `joined`. */
  connect(code: string, name: string, hostKey?: string): Promise<RoomView> {
    return new Promise((resolve, reject) => {
      this.close();
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
        ws.send(JSON.stringify({ t: 'join', code, name, key: hostKey }));
        this.pingTimer = window.setInterval(() => { this.pingAt = performance.now(); this.send({ t: 'ping', n: 1 }); }, 2000);
      };
      ws.onmessage = (ev) => {
        let m: ServerMessage;
        try { m = JSON.parse(String(ev.data)) as ServerMessage; } catch { return; }
        if (m.t === 'pong') { this.rtt = Math.round(performance.now() - this.pingAt); return; }
        if (m.t === 'joined') {
          this.you = m.you; this.isHost = m.host; this.room = m.room;
          if (!settled) { settled = true; resolve(m.room); }
        } else if (m.t === 'room') this.room = m.room;
        else if (m.t === 'start') this.room = m.room;
        else if (m.t === 'error' && !settled) fail(new NetError(m.code, errorText(m.code, m.msg)));
        this.emit(m);
      };
      ws.onerror = () => fail(new NetError('offline', 'No se pudo conectar con el servidor.'));
      ws.onclose = () => {
        this.connected = false;
        window.clearInterval(this.pingTimer);
        fail(new NetError('closed', 'La conexion se cerro.'));
        this.emit({ t: 'closed', reason: 'disconnected' });
      };
    });
  }

  send(m: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  close(): void {
    window.clearInterval(this.pingTimer);
    const ws = this.ws;
    this.ws = null;
    this.connected = false;
    if (ws) { ws.onclose = null; ws.onerror = null; ws.onmessage = null; try { ws.close(1000, 'bye'); } catch { /* closed */ } }
  }
}
