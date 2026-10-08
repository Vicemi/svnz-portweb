import { useEffect, useMemo, useRef, useState } from 'react';
import type { MatchEnd, SvnzGame } from '../svnz/game';
import { backend } from '../svnz/online/config';
import { NetClient, NetError, checkRoom, createRoom, type Mode, type RoomView, type ServerMessage } from '../svnz/online/net';
import { portrait } from '../svnz/online/portrait';
import { ROSTER, SLOT_COLORS, rosterOf } from '../svnz/online/roster';
import { difficultyOf } from '../svnz/online/scaling';

export type PanelKind = 'localCoop' | 'onlineCoop' | 'onlineVs' | 'join';

const CODE_CHARS = /[^ABCDEFGHJKMNPQRSTUVWXYZ23456789]/g;
const cleanNick = (s: string) => s.replace(/[^A-Za-z0-9 _.-]/g, '').slice(0, 12);

function Portrait({ char, size = 72 }: { char: string; size?: number }) {
  const src = useMemo(() => portrait(char), [char]);
  return src ? <img className="ol-portrait" src={src} width={size} height={size} alt="" draggable={false} /> : <span className="ol-portrait" style={{ width: size, height: size }} />;
}

function CharPicker({ value, onPick, label, color }: { value: string; onPick: (c: string) => void; label?: string; color?: string }) {
  const r = rosterOf(value);
  return (
    <div className="ol-picker">
      {label && <div className="ol-label" style={{ color }}>{label}</div>}
      <div className="ol-chars" role="radiogroup" aria-label="Personaje">
        {ROSTER.map((c) => (
          <button key={c.key} role="radio" aria-checked={c.key === value} className={'ol-char' + (c.key === value ? ' on' : '')} onClick={() => onPick(c.key)} title={c.name}>
            <Portrait char={c.key} size={64} />
            <span>{c.name}</span>
          </button>
        ))}
      </div>
      <div className="ol-info">
        <b>{r.name}</b> · {r.style} · Vida {r.life} · Velocidad {r.speed}
        <ul>{r.moves.map((m) => <li key={m}>{m}</li>)}</ul>
      </div>
    </div>
  );
}

function Setup() {
  return (
    <div className="ol-setup">
      <h2>Backend sin configurar</h2>
      <p>Los modos online necesitan un servidor <code>svnz-backend</code>. Quien publica esta página debe definir estas variables de entorno al compilarla:</p>
      <pre>{`PUBLIC_SVNZ_BACKEND_URL=https://tu-servidor.ejemplo.com\nPUBLIC_SVNZ_BACKEND_TOKEN=<GAME_TOKEN del .env del backend>`}</pre>
      <p>Falta: <code>{backend.problem}</code>. La guía completa está en el README del repositorio del backend (github.com/Vicemi/svnz-backend).</p>
    </div>
  );
}

/** Panels of the "VS y Online" menu: local co-op setup, create / join a room, and the lobby with character select. */
export default function OnlinePanel({ game, kind, initialCode, onClose }: { game: SvnzGame; kind: PanelKind; initialCode?: string; onClose: () => void }) {
  const [nick, setNick] = useState(() => { try { return cleanNick(localStorage.getItem('svnz-nick') ?? '') || 'Ninja'; } catch { return 'Ninja'; } });
  const [code, setCode] = useState(initialCode ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [room, setRoom] = useState<RoomView | null>(null);
  const [you, setYou] = useState(-1);
  const [host, setHost] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [result, setResult] = useState('');
  const [chars, setChars] = useState<[string, string]>(['Mina', 'DemonNinja']);
  const [ping, setPing] = useState(0);
  const [copied, setCopied] = useState(false);
  const netRef = useRef<NetClient | null>(null);
  const playingRef = useRef(false);

  const mode: Mode = kind === 'onlineVs' ? 'vs' : 'coop';
  const online = kind !== 'localCoop';

  // the menu behind the panel ignores the keyboard while the panel is up
  useEffect(() => { game.uiOpen = !playing; return () => { game.uiOpen = false; }; }, [game, playing]);
  useEffect(() => {
    const id = window.setInterval(() => setPing(netRef.current?.rtt ?? 0), 1000);
    return () => window.clearInterval(id);
  }, []);
  useEffect(() => () => { netRef.current?.close(); game.onMatchEnd = null; }, [game]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.code === 'Escape' && !playingRef.current) { e.preventDefault(); e.stopPropagation(); leave(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  const saveNick = (n: string) => { setNick(n); try { localStorage.setItem('svnz-nick', n); } catch { /* ignore */ } };
  const finalNick = () => cleanNick(nick).trim() || 'Ninja';

  const leave = () => {
    netRef.current?.send({ t: 'leave' });
    netRef.current?.close();
    netRef.current = null;
    onClose();
  };

  const attach = (net: NetClient) => {
    netRef.current = net;
    game.onMatchEnd = (e: MatchEnd) => {
      if (!e.online) return;
      playingRef.current = false;
      setPlaying(false);
      if (e.reason === 'closed') { netRef.current?.close(); netRef.current = null; setRoom(null); setError(e.text || 'La sala se cerró.'); return; }
      if (e.reason === 'left') { netRef.current?.close(); netRef.current = null; setRoom(null); onClose(); return; }
      setResult(e.text);
    };
    net.on((m: ServerMessage) => {
      if (m.t === 'room') setRoom(m.room);
      else if (m.t === 'start') { setError(''); setResult(''); playingRef.current = true; setPlaying(true); game.startOnline(net, m.room, m.difficulty, m.you); }
      else if (m.t === 'error') setError(m.msg);
      else if (m.t === 'closed' && !playingRef.current) { netRef.current = null; setRoom(null); setError(m.reason === 'host_left' ? 'El anfitrión cerró la sala.' : m.reason === 'idle' ? 'La sala se cerró por inactividad.' : 'Se perdió la conexión.'); }
    });
  };

  const fail = (e: unknown) => setError(e instanceof NetError ? e.message : 'No se pudo conectar con el servidor.');

  const create = async () => {
    setBusy(true); setError('');
    try {
      const r = await createRoom(mode);
      const net = new NetClient();
      attach(net);
      const v = await net.connect(r.code, finalNick(), r.hostKey);
      setRoom(v); setYou(net.you); setHost(net.isHost);
    } catch (e) { netRef.current?.close(); netRef.current = null; fail(e); }
    setBusy(false);
  };
  const join = async () => {
    setBusy(true); setError('');
    try {
      const c = code.trim();
      await checkRoom(c);
      const net = new NetClient();
      attach(net);
      const v = await net.connect(c, finalNick());
      setRoom(v); setYou(net.you); setHost(net.isHost);
    } catch (e) { netRef.current?.close(); netRef.current = null; fail(e); }
    setBusy(false);
  };

  const send = (m: Record<string, unknown>) => netRef.current?.send(m);
  const me = room?.players.find((p) => p.id === you);

  // ---------------------------------------------------------------- local co-op
  if (kind === 'localCoop') {
    const d = difficultyOf(chars);
    return (
      <div className="ol-overlay" role="dialog" aria-label="Coop local">
        <div className="ol-card">
          <h1>Coop local</h1>
          <p className="ol-sub">Dos jugadores en el mismo teclado. Pasen el juego juntos: con dos jugadores hay más enemigos (×{d.count}), con {Math.round((d.hp - 1) * 100)}% más de vida.</p>
          <div className="ol-two">
            <CharPicker value={chars[0]} onPick={(c) => setChars([c, chars[1]])} label="Jugador 1" color={SLOT_COLORS[0]} />
            <CharPicker value={chars[1]} onPick={(c) => setChars([chars[0], c])} label="Jugador 2" color={SLOT_COLORS[1]} />
          </div>
          <div className="ol-keys">
            <div><b style={{ color: SLOT_COLORS[0] }}>J1</b> Flechas mover · Q rápido · W fuerte · E salto · A especial · S defensa · D dash</div>
            <div><b style={{ color: SLOT_COLORS[1] }}>J2</b> I J K L mover · U rápido · O fuerte · P salto · N especial · M defensa · , dash</div>
          </div>
          <div className="ol-actions">
            <button className="ol-btn" onClick={onClose}>Atrás</button>
            <button className="ol-btn primary" onClick={() => { onClose(); game.startLocalCoop(chars, ['P1', 'P2']); }}>¡A pelear!</button>
          </div>
        </div>
      </div>
    );
  }

  if (!backend.configured) {
    return (
      <div className="ol-overlay"><div className="ol-card"><Setup /><div className="ol-actions"><button className="ol-btn" onClick={onClose}>Cerrar</button></div></div></div>
    );
  }

  // ---------------------------------------------------------------- not in a room yet
  if (!room) {
    return (
      <div className="ol-overlay" role="dialog" aria-label={kind === 'join' ? 'Unirse' : 'Crear sala'}>
        <div className="ol-card narrow">
          <h1>{kind === 'join' ? 'Unirse a una sala' : mode === 'vs' ? 'Crear sala VS' : 'Crear sala Coop'}</h1>
          <p className="ol-sub">
            {kind === 'join' ? 'Pedile el código de 5 letras a quien creó la sala.' : mode === 'vs' ? 'Hasta 4 contra 4. Vos sos el anfitrión: pasales el código a tus amigos y empezás cuando estén todos.' : 'Hasta 4 jugadores para pasar el juego juntos. Cada jugador extra hace las oleadas más difíciles.'}
          </p>
          <label className="ol-field">Tu nombre
            <input value={nick} maxLength={12} onChange={(e) => saveNick(cleanNick(e.target.value))} autoComplete="off" spellCheck={false} />
          </label>
          {kind === 'join' && (
            <label className="ol-field">Código de sala
              <input className="ol-code-in" value={code} maxLength={5} onChange={(e) => setCode(e.target.value.toUpperCase().replace(CODE_CHARS, ''))} autoComplete="off" spellCheck={false} autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter' && code.length === 5 && !busy) void join(); }} />
            </label>
          )}
          {error && <div className="ol-error" role="alert">{error}</div>}
          <div className="ol-actions">
            <button className="ol-btn" onClick={onClose}>Atrás</button>
            {kind === 'join'
              ? <button className="ol-btn primary" disabled={busy || code.length !== 5} onClick={() => void join()}>{busy ? 'Conectando…' : 'Unirse'}</button>
              : <button className="ol-btn primary" disabled={busy} onClick={() => void create()}>{busy ? 'Creando…' : 'Crear sala'}</button>}
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------- lobby
  const others = room.players.filter((p) => p.id !== you);
  const allReady = room.players.every((p) => p.ready);
  const teamsOk = room.mode !== 'vs' || (room.players.some((p) => p.team === 1) && room.players.some((p) => p.team === 2));
  const canStart = host && allReady && teamsOk;
  const hint = !allReady ? 'Faltan jugadores por marcar «Listo»' : !teamsOk ? 'El VS necesita jugadores en los dos equipos' : '';
  const d = room.difficulty;
  const link = `${location.origin}${location.pathname}?room=${room.code}`;
  const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); setCopied(true); window.setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ } };
  const slots = Array.from({ length: room.max }, (_, i) => room.players[i]);

  return (
    <div className="ol-overlay" style={{ display: playing ? 'none' : undefined }} role="dialog" aria-label="Sala">
      <div className="ol-card wide">
        <div className="ol-head">
          <div>
            <h1>{room.mode === 'vs' ? 'VS' : 'Coop'} · Sala</h1>
            <div className="ol-code" aria-label="Código de la sala">{room.code}</div>
            <div className="ol-copy">
              <button className="ol-btn small" onClick={() => void copy(room.code)}>{copied ? '¡Copiado!' : 'Copiar código'}</button>
              <button className="ol-btn small" onClick={() => void copy(link)}>Copiar enlace</button>
            </div>
          </div>
          <div className="ol-meta">
            <div>{room.players.length}/{room.max} jugadores</div>
            {ping > 0 && <div>Ping {ping} ms</div>}
            {host && (
              <div className="ol-mode">
                <button className={'ol-btn small' + (room.mode === 'coop' ? ' on' : '')} onClick={() => send({ t: 'mode', mode: 'coop' })}>Coop</button>
                <button className={'ol-btn small' + (room.mode === 'vs' ? ' on' : '')} onClick={() => send({ t: 'mode', mode: 'vs' })}>VS</button>
              </div>
            )}
          </div>
        </div>
        {result && <div className="ol-result">{result}</div>}
        {error && <div className="ol-error" role="alert">{error}</div>}

        <div className="ol-slots">
          {slots.map((p, i) => p ? (
            <div key={p.id} className={'ol-slot' + (p.id === you ? ' me' : '')} style={{ borderColor: SLOT_COLORS[p.id % SLOT_COLORS.length] }}>
              <Portrait char={p.char} size={64} />
              <div className="ol-slot-t">
                <b>{p.name}{p.host ? ' ★' : ''}</b>
                <span>{rosterOf(p.char).name}</span>
                {room.mode === 'vs' && <span className={'ol-team t' + p.team}>Equipo {p.team}</span>}
              </div>
              <span className={'ol-ok' + (p.ready ? ' on' : '')}>{p.ready ? 'Listo' : '…'}</span>
            </div>
          ) : <div key={'e' + i} className="ol-slot empty">Esperando…</div>)}
        </div>

        {me && <CharPicker value={me.char} onPick={(c) => send({ t: 'char', char: c })} label="Tu personaje" color={SLOT_COLORS[me.id % SLOT_COLORS.length]} />}

        {room.mode === 'vs' && me && (
          <div className="ol-teams">
            Equipo:
            <button className={'ol-btn small' + (me.team === 1 ? ' on' : '')} onClick={() => send({ t: 'team', team: 1 })}>1</button>
            <button className={'ol-btn small' + (me.team === 2 ? ' on' : '')} onClick={() => send({ t: 'team', team: 2 })}>2</button>
          </div>
        )}
        {room.mode === 'coop' && (
          <div className="ol-diff">Dificultad con este grupo: enemigos ×{d.count} en pantalla y por oleada · vida de enemigos ×{d.hp} · jefes ×{d.boss}</div>
        )}

        <div className="ol-actions">
          <button className="ol-btn" onClick={leave}>{host ? 'Cerrar sala' : 'Salir'}</button>
          {host
            ? <button className="ol-btn primary" disabled={!canStart} title={hint} onClick={() => send({ t: 'start' })}>{canStart ? 'Empezar' : hint || 'Empezar'}</button>
            : <button className={'ol-btn primary' + (me?.ready ? ' on' : '')} onClick={() => send({ t: 'ready', ready: !me?.ready })}>{me?.ready ? 'Listo ✓ (quitar)' : 'Estoy listo'}</button>}
        </div>
        {others.length === 0 && host && <p className="ol-sub">Pasale el código a tus amigos para que se unan.</p>}
      </div>
    </div>
  );
}
