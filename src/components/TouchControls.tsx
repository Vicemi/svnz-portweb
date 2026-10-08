import { useEffect, useRef, useState } from 'react';
import { touchButtons } from '../svnz/online/controls';

/**
 * Mobile controls for Super Vampire Ninja Zero (a 2.5D beat 'em up, so the stick moves on 8 directions):
 * - LEFT half: floating joystick (arrows).
 * - RIGHT half: the six buttons of the original keyboard layout, as a fighting-game cluster:
 *     Q fast attack, W strong attack, E jump, A special, S defense/parry, D dash.
 * Each finger is tracked on its own and can slide between buttons. Everything becomes keyboard events, so the
 * game's own input code (bat::Keyboard semantics) is reused unchanged.
 */

type Key = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown' | 'KeyQ' | 'KeyW' | 'KeyE' | 'KeyA' | 'KeyS' | 'KeyD';

const STICK_RADIUS = 56;
const DEAD_ZONE = 14;

/** Color of each action's ring (the same ones the keyboard-shaped cluster had). */
const RING: Partial<Record<Key, string>> = {
  KeyQ: 'rgba(255,210,120,0.85)', KeyW: 'rgba(255,120,120,0.85)', KeyE: 'rgba(140,220,255,0.85)',
  KeyA: 'rgba(220,140,255,0.85)', KeyS: 'rgba(160,255,160,0.85)', KeyD: 'rgba(255,255,160,0.85)',
};
const LETTER: Record<string, string> = { KeyQ: 'Q', KeyW: 'W', KeyE: 'E', KeyA: 'A', KeyS: 'S', KeyD: 'D' };

const held = new Map<Key, number>();
function keyDown(code: Key): void {
  const n = held.get(code) ?? 0;
  held.set(code, n + 1);
  if (n === 0) window.dispatchEvent(new KeyboardEvent('keydown', { code }));
}
function keyUp(code: Key): void {
  const n = held.get(code) ?? 0;
  if (n <= 1) {
    held.delete(code);
    if (n === 1) window.dispatchEvent(new KeyboardEvent('keyup', { code }));
  } else held.set(code, n - 1);
}
function releaseAll(): void {
  for (const code of [...held.keys()]) window.dispatchEvent(new KeyboardEvent('keyup', { code }));
  held.clear();
}
const buzz = (ms: number) => { try { navigator.vibrate?.(ms); } catch { /* not supported */ } };

/** 8-way: a direction counts when its axis is past ~22.5° of the drag angle. */
function stickKeys(dx: number, dy: number): Key[] {
  const d = Math.hypot(dx, dy);
  if (d < DEAD_ZONE) return [];
  const out: Key[] = [];
  if (Math.abs(dx) / d > 0.38) out.push(dx > 0 ? 'ArrowRight' : 'ArrowLeft');
  if (Math.abs(dy) / d > 0.38) out.push(dy > 0 ? 'ArrowDown' : 'ArrowUp');
  return out;
}

interface Stick { id: number; ox: number; oy: number; x: number; y: number; keys: Key[] }

/** `char`: the character being played (only its buttons are shown, with what each does); `star`: the ninja-star power-up is active. */
export default function TouchControls({ active, char = 'Mina', star = false }: { active: boolean; char?: string; star?: boolean }) {
  const buttons = touchButtons(char, star);
  const refs = useRef(new Map<Key, HTMLDivElement>());
  const stick = useRef<Stick | null>(null);
  const fingers = useRef(new Map<number, Key | null>());
  const [view, setView] = useState<{ ox: number; oy: number; x: number; y: number } | null>(null);
  const [down, setDown] = useState<Set<Key>>(new Set());

  useEffect(() => {
    if (!active) {
      stick.current = null;
      fingers.current.clear();
      setView(null);
      setDown(new Set());
      releaseAll();
    }
  }, [active]);
  useEffect(() => {
    const blur = () => { stick.current = null; fingers.current.clear(); setView(null); setDown(new Set()); releaseAll(); };
    window.addEventListener('blur', blur);
    document.addEventListener('visibilitychange', blur);
    return () => { window.removeEventListener('blur', blur); document.removeEventListener('visibilitychange', blur); };
  }, []);

  const refresh = () => setDown(new Set([...fingers.current.values()].filter((k): k is Key => !!k)));

  const buttonAt = (x: number, y: number): Key | null => {
    let best: Key | null = null, bd = Infinity;
    for (const [k, el] of refs.current) {
      const r = el.getBoundingClientRect();
      const d = Math.hypot(x - (r.left + r.width / 2), y - (r.top + r.height / 2));
      if (d <= r.width / 2 + 14 && d < bd) { bd = d; best = k; }
    }
    return best;
  };

  const setStickKeys = (s: Stick, keys: Key[]) => {
    for (const k of s.keys) if (!keys.includes(k)) keyUp(k);
    for (const k of keys) if (!s.keys.includes(k)) keyDown(k);
    s.keys = keys;
  };

  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    try { (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); } catch { /* gone */ }
    const x = e.clientX, y = e.clientY;
    if (x < window.innerWidth * 0.45) {
      if (stick.current) return;
      stick.current = { id: e.pointerId, ox: x, oy: y, x, y, keys: [] };
      setView({ ox: x, oy: y, x, y });
    } else {
      const key = buttonAt(x, y);
      fingers.current.set(e.pointerId, key);
      if (key) { keyDown(key); buzz(8); }
      refresh();
    }
  };

  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const s = stick.current;
    if (s && s.id === e.pointerId) {
      let { ox, oy } = s;
      const x = e.clientX, y = e.clientY;
      const dx = x - ox, dy = y - oy, d = Math.hypot(dx, dy);
      if (d > STICK_RADIUS) { ox = x - (dx / d) * STICK_RADIUS; oy = y - (dy / d) * STICK_RADIUS; }
      s.ox = ox; s.oy = oy; s.x = x; s.y = y;
      setStickKeys(s, stickKeys(x - ox, y - oy));
      setView({ ox, oy, x, y });
      return;
    }
    if (fingers.current.has(e.pointerId)) {
      const cur = fingers.current.get(e.pointerId) ?? null;
      const key = buttonAt(e.clientX, e.clientY);
      if (key && key !== cur) {
        if (cur) keyUp(cur);
        keyDown(key);
        fingers.current.set(e.pointerId, key);
        buzz(6);
        refresh();
      }
    }
  };

  const onUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const s = stick.current;
    if (s && s.id === e.pointerId) {
      setStickKeys(s, []);
      stick.current = null;
      setView(null);
      return;
    }
    if (fingers.current.has(e.pointerId)) {
      const k = fingers.current.get(e.pointerId);
      if (k) keyUp(k);
      fingers.current.delete(e.pointerId);
      refresh();
    }
  };

  if (!active) return null;
  const knob = view ? (() => {
    const dx = view.x - view.ox, dy = view.y - view.oy, d = Math.hypot(dx, dy) || 1;
    const k = Math.min(1, STICK_RADIUS / d);
    return { x: view.ox + dx * k, y: view.oy + dy * k };
  })() : null;

  return (
    <div className="sv-touch" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
      onContextMenu={(e) => e.preventDefault()}>
      {view && knob ? (
        <>
          <div className="sv-stick-ring" style={{ left: view.ox, top: view.oy }} />
          <div className="sv-stick-knob" style={{ left: knob.x, top: knob.y }} />
        </>
      ) : (
        <div className="sv-stick-hint" aria-hidden="true"><span>✥</span></div>
      )}
      {buttons.map((b, i) => (
        <div key={b.key} ref={(el) => { if (el) refs.current.set(b.key, el); else refs.current.delete(b.key); }}
          className={`sv-act sv-slot-${i}` + (down.has(b.key) ? ' is-down' : '')} style={{ borderColor: RING[b.key] }} aria-label={b.label}>
          <span className="sv-act-k">{b.label}</span><span className="sv-act-s">{LETTER[b.key]}</span>
        </div>
      ))}
    </div>
  );
}
