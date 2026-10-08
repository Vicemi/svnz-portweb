import { useEffect, useMemo, useRef, useState } from 'react';
import type { MatchEnd, SvnzGame } from '../svnz/game';
import { backend } from '../svnz/online/config';
import { ITEMS, defaultSettings, type ItemKey } from '../svnz/online/items';
import { NetClient, NetError, checkRoom, checkServer, createRoom, forgetSession, storedSession, type Mode, type RoomView, type ServerMessage } from '../svnz/online/net';
import { portrait } from '../svnz/online/portrait';
import { SLOT_COLORS, rosterFor, rosterOf } from '../svnz/online/roster';
import { difficultyOf } from '../svnz/online/scaling';
import { paletteOf, variantCount } from '../svnz/online/variants';

export type PanelKind = 'localCoop' | 'onlineCoop' | 'onlineVs' | 'join' | 'resume';

const CODE_CHARS = /[^ABCDEFGHJKMNPQRSTUVWXYZ23456789]/g;
const cleanNick = (s: string) => s.replace(/[^A-Za-z0-9 _.-]/g, '').slice(0, 10);

function Portrait({ char, variant, size = 72 }: { char: string; variant?: number; size?: number }) {
  const src = useMemo(() => portrait(char, variant === undefined ? -1 : paletteOf(char, variant)), [char, variant]);
  return src ? <img className="ol-portrait" src={src} width={size} height={size} alt="" draggable={false} /> : <span className="ol-portrait" style={{ width: size, height: size }} />;
}

/** A power-up icon from the game's own sprite sheet (the same pixels as in the fight). */
function ItemIcon({ id, size = 2 }: { id: number; size?: number }) {
  return <span className="ol-ico" style={{ width: 22 * size, height: 22 * size, backgroundSize: `${88 * size}px ${144 * size}px`, backgroundPosition: `0 -${(id - 1) * 22 * size}px` }} aria-hidden />;
}

/** Character grid + the colour variants of the chosen one (up to 4). Colours another player of the room already has are locked. */
function CharPicker({ mode, value, variant, taken, onPick, onVariant, label, color }: {
  mode: Mode; value: string; variant: number; taken: { char: string; variant: number; name: string }[];
  onPick: (c: string) => void; onVariant: (v: number) => void; label?: string; color?: string;
}) {
  const r = rosterOf(value);
  const n = variantCount(value);
  const owner = (char: string, v: number) => taken.find((t) => t.char === char && t.variant === v)?.name;
  return (
    <div className="ol-picker">
      {label && <div className="ol-label" style={{ color }}>{label}</div>}
      <div className="ol-chars" role="radiogroup" aria-label="Personaje">
        {rosterFor(mode).map((c) => {
          const full = c.key !== value && Array.from({ length: variantCount(c.key) }, (_, v) => owner(c.key, v)).every(Boolean);
          return (
            <button key={c.key} role="radio" aria-checked={c.key === value} disabled={full} className={'ol-char' + (c.key === value ? ' on' : '')} onClick={() => onPick(c.key)} title={full ? 'Todos sus colores están ocupados' : c.name}>
              <Portrait char={c.key} variant={c.key === value ? variant : undefined} size={56} />
              <span>{c.name}</span>
            </button>
          );
        })}
      </div>
      <div className="ol-label">Color</div>
      <div className="ol-variants" role="radiogroup" aria-label="Color">
        {Array.from({ length: n }, (_, v) => {
          const who = owner(value, v);
          return (
            <button key={v} role="radio" aria-checked={v === variant} disabled={!!who} className={'ol-var' + (v === variant ? ' on' : '') + (who ? ' locked' : '')} onClick={() => onVariant(v)} title={who ? `Lo tiene ${who}` : `Color ${v + 1}`}>
              <Portrait char={value} variant={v} size={44} />
              {who && <em>{who.slice(0, 6)}</em>}
            </button>
          );
        })}
        {n === 1 && <span className="ol-note">Este personaje tiene un solo color.</span>}
      </div>
      <div className="ol-info">
        <b>{r.name}</b> · {r.style} · Vida {r.life} · Velocidad {r.speed}{r.vsOnly ? ' · Solo VS' : ''}
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

/** Panels of the "VS y Online" menu: local co-op setup, create / join a room, the lobby with character select, and the way back after a reload. */
export default function OnlinePanel({ game, kind, initialCode, onClose }: { game: SvnzGame; kind: PanelKind; initialCode?: string; onClose: () => void }) {
  const [nick, setNick] = useState(() => { try { return cleanNick(localStorage.getItem('svnz-nick') ?? '') || 'Ninja'; } catch { return 'Ninja'; } });
  const [code, setCode] = useState(initialCode ?? '');
  const [busy, setBusy] = useState(kind === 'resume');
  const [error, setError] = useState('');
  const [room, setRoom] = useState<RoomView | null>(null);
  const [you, setYou] = useState(-1);
  const [host, setHost] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [result, setResult] = useState('');
  const [chars, setChars] = useState<[string, string]>(['Mina', 'DemonNinja']);
  const [vars, setVars] = useState<[number, number]>([0, 0]);
  const [ping, setPing] = useState(0);
  const [copied, setCopied] = useState(false);
  const [link, setLink] = useState<'ok' | 'lost'>('ok');
  const netRef = useRef<NetClient | null>(null);
  const playingRef = useRef(false);

  const mode: Mode = kind === 'onlineVs' ? 'vs' : 'coop';

  // the menu behind the panel ignores the keyboard while the panel is up
  useEffect(() => { game.uiOpen = !playing; return () => { game.uiOpen = false; }; }, [game, playing]);
  useEffect(() => {
    const id = window.setInterval(() => {
      setPing(netRef.current?.rtt ?? 0);
      // safety net: the panel is hidden only while a match is really running
      if (playingRef.current && !game.match) { playingRef.current = false; setPlaying(false); }
    }, 1000);
    return () => window.clearInterval(id);
  }, [game]);
  useEffect(() => () => { netRef.current?.close(false); game.onMatchEnd = null; }, [game]);   // closing the panel by reloading must NOT forget the session
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
    forgetSession();
    onClose();
  };

  const back = (text: string) => { netRef.current?.close(); netRef.current = null; setRoom(null); setYou(-1); setPlaying(false); playingRef.current = false; if (text) setError(text); };

  const attach = (net: NetClient) => {
    netRef.current = net;
    game.onMatchEnd = (e: MatchEnd) => {
      if (!e.online) return;
      playingRef.current = false;
      setPlaying(false);
      if (e.reason === 'closed') { back(e.text || 'La sala se cerró.'); return; }
      if (e.reason === 'left') { back(''); onClose(); return; }
      setResult(e.text);
    };
    net.on((m: ServerMessage) => {
      if (m.t === 'room') setRoom(m.room);
      else if (m.t === 'start') { setError(''); setResult(''); playingRef.current = true; setPlaying(true); game.startOnline(net, m.room, m.difficulty, m.you); }
      else if (m.t === 'error') setError(m.msg);
      else if (m.t === 'link') setLink(m.state === 'lost' ? 'lost' : 'ok');
      else if (m.t === 'kicked') { if (!playingRef.current) back('El anfitrión te sacó de la sala.'); }
      else if (m.t === 'ended') {
        const d = m.d as { aborted?: boolean } | null;
        if (!playingRef.current) setResult(d?.aborted ? 'La partida se terminó.' : '');
      } else if (m.t === 'closed' && !playingRef.current) {
        back(m.reason === 'host_left' ? 'El anfitrión cerró la sala.' : m.reason === 'idle' ? 'La sala se cerró por inactividad.' : m.reason === 'session_lost' ? 'No se pudo volver a la sala: la sesión venció.' : m.reason === 'server_restart' ? 'El servidor se reinició.' : 'Se perdió la conexión.');
      }
    });
  };

  const fail = (e: unknown) => setError(e instanceof NetError ? e.message : 'No se pudo conectar con el servidor.');

  const create = async () => {
    setBusy(true); setError('');
    try {
      await checkServer();
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
      await checkServer();
      await checkRoom(c).catch((e) => { if (e instanceof NetError && e.code === 'not_found') throw e; });
      const net = new NetClient();
      attach(net);
      const v = await net.connect(c, finalNick());
      setRoom(v); setYou(net.you); setHost(net.isHost);
    } catch (e) { netRef.current?.close(); netRef.current = null; fail(e); }
    setBusy(false);
  };

  // came back after a page reload: take the seat again
  useEffect(() => {
    if (kind !== 'resume') return;
    const s = storedSession();
    if (!s || !backend.configured) { forgetSession(); onClose(); return; }
    const net = new NetClient();
    attach(net);
    net.resume(s).then(async (v) => {
      await game.whenReady();   // the lobby draws the characters' pictures: the sprites must be loaded first
      setRoom(v); setYou(net.you); setHost(net.isHost); setBusy(false);
      if (v.status === 'playing') {
        if (net.isHost) net.send({ t: 'end', d: { aborted: true } });   // the match lived in this page, which was reloaded: it cannot go on
        else { playingRef.current = true; setPlaying(true); game.startOnline(net, v, v.difficulty, net.you); }
      }
    }).catch((e) => { forgetSession(); netRef.current = null; setBusy(false); fail(e); onCloseLater(); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const onCloseLater = () => { window.setTimeout(() => { /* the error stays visible until the player closes the panel */ }, 0); };

  const send = (m: Record<string, unknown>) => netRef.current?.send(m);
  const me = room?.players.find((p) => p.id === you);
  const setItems = (items: ItemKey[], powerups = (room!.settings ?? defaultSettings(room!.mode)).powerups, lives = (room!.settings ?? defaultSettings(room!.mode)).lives) => send({ t: 'settings', powerups, items, lives });

  // ---------------------------------------------------------------- local co-op
  if (kind === 'localCoop') {
    const d = difficultyOf(chars);
    const free = (char: string, other: { char: string; v: number }) => Array.from({ length: variantCount(char) }, (_, v) => v).find((v) => !(other.char === char && other.v === v)) ?? 0;
    const pick = (who: 0 | 1, c: string) => {
      const o = who === 0 ? { char: chars[1], v: vars[1] } : { char: chars[0], v: vars[0] };
      const nc: [string, string] = who === 0 ? [c, chars[1]] : [chars[0], c];
      const nv: [number, number] = who === 0 ? [free(c, o), vars[1]] : [vars[0], free(c, o)];
      setChars(nc); setVars(nv);
    };
    const takenBy = (who: 0 | 1) => (who === 0 ? [{ char: chars[1], variant: vars[1], name: 'J2' }] : [{ char: chars[0], variant: vars[0], name: 'J1' }]);
    return (
      <div className="ol-overlay" role="dialog" aria-label="Coop local">
        <div className="ol-card">
          <h1>Coop local</h1>
          <p className="ol-sub">Dos jugadores en el mismo teclado. Pasen el juego juntos: con dos jugadores hay más enemigos (×{d.count}), con {Math.round((d.hp - 1) * 100)}% más de vida.</p>
          <div className="ol-two">
            <CharPicker mode="coop" value={chars[0]} variant={vars[0]} taken={takenBy(0)} onPick={(c) => pick(0, c)} onVariant={(v) => setVars([v, vars[1]])} label="Jugador 1" color={SLOT_COLORS[0]} />
            <CharPicker mode="coop" value={chars[1]} variant={vars[1]} taken={takenBy(1)} onPick={(c) => pick(1, c)} onVariant={(v) => setVars([vars[0], v])} label="Jugador 2" color={SLOT_COLORS[1]} />
          </div>
          {typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches && (
            <div className="ol-error" role="note">El coop local necesita un teclado para el jugador 2. En el celular usá las salas online (Crear sala / Unirse).</div>
          )}
          <div className="ol-keys">
            <div><b style={{ color: SLOT_COLORS[0] }}>J1</b> Flechas mover · Q rápido · W fuerte · E salto · A especial · S defensa · D dash</div>
            <div><b style={{ color: SLOT_COLORS[1] }}>J2</b> I J K L mover · U rápido · O fuerte · P salto · N especial · M defensa · , dash</div>
          </div>
          <div className="ol-actions">
            <button className="ol-btn" onClick={onClose}>Atrás</button>
            <button className="ol-btn primary" onClick={() => { onClose(); game.startLocalCoop(chars, ['P1', 'P2'], vars); }}>¡A pelear!</button>
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
    if (kind === 'resume' && busy) {
      return (<div className="ol-overlay"><div className="ol-card narrow"><h1>Volviendo a la sala…</h1><p className="ol-sub">Recuperando tu lugar.</p></div></div>);
    }
    const asJoin = kind === 'join' || kind === 'resume';
    return (
      <div className="ol-overlay" role="dialog" aria-label={asJoin ? 'Unirse' : 'Crear sala'}>
        <div className="ol-card narrow">
          <h1>{asJoin ? 'Unirse a una sala' : mode === 'vs' ? 'Crear sala VS' : 'Crear sala Coop'}</h1>
          <p className="ol-sub">
            {asJoin ? 'Pedile el código de 5 letras a quien creó la sala. Si te desconectaste, entrá con el mismo código y el mismo nombre para recuperar tu lugar.' : mode === 'vs' ? 'Hasta 4 jugadores, todos contra todos (1v1, 1v1v1 o 1v1v1v1), con 3 vidas cada uno. Vos sos el anfitrión: pasales el código a tus amigos y empezás cuando estén todos.' : 'Hasta 4 jugadores para pasar el juego juntos. Cada jugador extra hace las oleadas más difíciles.'}
          </p>
          <label className="ol-field">Tu nombre (hasta 10)
            <input value={nick} maxLength={10} onChange={(e) => saveNick(cleanNick(e.target.value))} autoComplete="off" spellCheck={false} />
          </label>
          {asJoin && (
            <label className="ol-field">Código de sala
              <input className="ol-code-in" value={code} maxLength={5} onChange={(e) => setCode(e.target.value.toUpperCase().replace(CODE_CHARS, ''))} autoComplete="off" spellCheck={false} autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter' && code.length === 5 && !busy) void join(); }} />
            </label>
          )}
          {error && <div className="ol-error" role="alert">{error}</div>}
          <div className="ol-actions">
            <button className="ol-btn" onClick={onClose}>Atrás</button>
            {asJoin
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
  const allOnline = room.players.every((p) => p.online);
  const enough = room.mode !== 'vs' || room.players.length >= 2;
  const canStart = host && allReady && allOnline && enough;
  const hint = !allOnline ? 'Un jugador perdió la conexión' : !allReady ? 'Faltan jugadores por marcar «Listo»' : !enough ? 'El VS necesita al menos 2 jugadores' : '';
  const d = room.difficulty;
  const st = room.settings ?? defaultSettings(room.mode);
  const link_ = `${location.origin}${location.pathname}?room=${room.code}`;
  const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); setCopied(true); window.setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ } };
  const slots = Array.from({ length: room.max }, (_, i) => room.players[i]);
  const available = ITEMS.filter((i) => room.mode === 'coop' || !i.coopOnly);

  return (
    <div className="ol-overlay" style={{ display: playing ? 'none' : undefined }} role="dialog" aria-label="Sala">
      <div className="ol-card wide">
        <div className="ol-head">
          <div>
            <h1>{room.mode === 'vs' ? 'VS · Todos contra todos' : 'Coop'} · Sala</h1>
            <div className="ol-code" aria-label="Código de la sala">{room.code}</div>
            <div className="ol-copy">
              <button className="ol-btn small" onClick={() => void copy(room.code)}>{copied ? '¡Copiado!' : 'Copiar código'}</button>
              <button className="ol-btn small" onClick={() => void copy(link_)}>Copiar enlace</button>
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
        {link === 'lost' && <div className="ol-error" role="status">Reconectando… tu lugar se mantiene unos segundos.</div>}
        {result && <div className="ol-result">{result}</div>}
        {error && <div className="ol-error" role="alert">{error}</div>}

        <div className="ol-slots">
          {slots.map((p, i) => p ? (
            <div key={p.id} className={'ol-slot' + (p.id === you ? ' me' : '') + (p.online ? '' : ' off')} style={{ borderColor: SLOT_COLORS[p.id % SLOT_COLORS.length] }}>
              <Portrait char={p.char} variant={p.variant} size={56} />
              <div className="ol-slot-t">
                <b>{p.name}{p.host ? ' ★' : ''}</b>
                <span>{rosterOf(p.char).name}</span>
                {!p.online && <span className="ol-lost">reconectando…</span>}
              </div>
              <span className={'ol-ok' + (p.ready ? ' on' : '')}>{p.ready ? 'Listo' : '…'}</span>
              {host && p.id !== you && <button className="ol-kick" title={`Sacar a ${p.name}`} aria-label={`Sacar a ${p.name}`} onClick={() => send({ t: 'kick', id: p.id })}>✕</button>}
            </div>
          ) : <div key={'e' + i} className="ol-slot empty">Esperando…</div>)}
        </div>

        {me && <CharPicker mode={room.mode} value={me.char} variant={me.variant} taken={others.map((o) => ({ char: o.char, variant: o.variant, name: o.name }))} onPick={(c) => send({ t: 'char', char: c })} onVariant={(v) => send({ t: 'variant', v })} label="Tu personaje" color={SLOT_COLORS[me.id % SLOT_COLORS.length]} />}

        <div className="ol-settings">
          <div className="ol-label">Power-ups {host ? '' : '(los elige el anfitrión)'}</div>
          <label className="ol-switch">
            <input type="checkbox" checked={st.powerups} disabled={!host} onChange={(e) => setItems(st.items, e.target.checked)} />
            <span>Aparecen power-ups durante la partida</span>
          </label>
          <div className={'ol-items' + (st.powerups ? '' : ' off')}>
            {available.map((it) => {
              const on = st.items.includes(it.key);
              return (
                <button key={it.key} className={'ol-item' + (on ? ' on' : '')} disabled={!host || !st.powerups} aria-pressed={on} title={it.blurb}
                  onClick={() => setItems(on ? st.items.filter((k) => k !== it.key) : [...st.items, it.key])}>
                  <ItemIcon id={it.id} />
                  <b>{it.name}</b>
                  <small>{it.blurb}</small>
                </button>
              );
            })}
          </div>
          {room.mode === 'vs' && (
            <div className="ol-teams">
              Vidas por jugador:
              {[1, 2, 3].map((n) => <button key={n} className={'ol-btn small' + (st.lives === n ? ' on' : '')} disabled={!host} onClick={() => setItems(st.items, st.powerups, n)}>{n}</button>)}
            </div>
          )}
        </div>
        {room.mode === 'coop' && (
          <div className="ol-diff">Dificultad con este grupo: enemigos ×{d.count} en pantalla y por oleada · vida de enemigos ×{d.hp} · jefes ×{d.boss}. Si algún amigo cae, puede aparecer un corazón para revivirlo.</div>
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
