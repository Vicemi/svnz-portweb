// Keyboard state with bat::Keyboard semantics: isDown (held) and isPressed (pressed this update).
// Bindings follow the original readme: arrows move, Q fast, W strong, E jump, A special, S defense/parry, D dash,
// ENTER help/confirm, ESC exit. Button indices are the game's UserPad order (svnz.exe 00419b40):
//   0 jump, 1 fast attack, 2 strong attack, 3 dash, 4 special, 5 defense.

export type Key = 'up' | 'down' | 'left' | 'right' | 'b0' | 'b1' | 'b2' | 'b3' | 'b4' | 'b5' | 'enter' | 'esc';

const BINDINGS: Record<Key, string[]> = {
  up: ['ArrowUp'],
  down: ['ArrowDown'],
  left: ['ArrowLeft'],
  right: ['ArrowRight'],
  b0: ['KeyE'],
  b1: ['KeyQ'],
  b2: ['KeyW'],
  b3: ['KeyD'],
  b4: ['KeyA'],
  b5: ['KeyS'],
  enter: ['Enter', 'NumpadEnter'],
  esc: ['Escape'],
};

const down = new Set<string>();
const tapped = new Set<string>();
let prev = new Set<string>();
let curr = new Set<string>();
let anyQueued = false;
let anyThisFrame = false;

export function attachInput(target: Window = window): () => void {
  const kd = (e: KeyboardEvent) => {
    if (!down.has(e.code)) { anyQueued = true; tapped.add(e.code); }
    down.add(e.code);
    if (e.code.startsWith('Arrow') || e.code === 'Space' || e.code === 'Enter') e.preventDefault();
  };
  const ku = (e: KeyboardEvent) => {
    down.delete(e.code);
    if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
  };
  const clear = () => down.clear();
  const vis = () => { if (document.hidden) down.clear(); };
  target.addEventListener('keydown', kd);
  target.addEventListener('keyup', ku);
  target.addEventListener('blur', clear);
  target.addEventListener('focus', clear);
  document.addEventListener('visibilitychange', vis);
  return () => {
    target.removeEventListener('keydown', kd);
    target.removeEventListener('keyup', ku);
    target.removeEventListener('blur', clear);
    target.removeEventListener('focus', clear);
    document.removeEventListener('visibilitychange', vis);
  };
}

export function resetInput(): void {
  down.clear();
  tapped.clear();
  prev = new Set();
  curr = new Set();
}

/** Call once per fixed update, before game logic reads input. */
export function pollInput(): void {
  prev = curr;
  curr = new Set(down);
  for (const k of tapped) { curr.add(k); prev.delete(k); }
  tapped.clear();
  anyThisFrame = anyQueued;
  anyQueued = false;
}

export function isDown(k: Key): boolean {
  return BINDINGS[k].some((c) => curr.has(c));
}
export function isPressed(k: Key): boolean {
  return BINDINGS[k].some((c) => curr.has(c) && !prev.has(c));
}
export function anyPressed(): boolean {
  return anyThisFrame;
}
