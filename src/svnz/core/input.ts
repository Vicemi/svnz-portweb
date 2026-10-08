// Keyboard state with bat::Keyboard semantics: isDown (held) and isPressed (pressed this update).
// Bindings follow the original readme: arrows move, Q fast, W strong, E jump, A special, S defense/parry, D dash,
// ENTER help/confirm, ESC exit. Button indices are the game's UserPad order (svnz.exe 00419b40):
//   0 jump, 1 fast attack, 2 strong attack, 3 dash, 4 special, 5 defense.

export type Key = 'up' | 'down' | 'left' | 'right' | 'b0' | 'b1' | 'b2' | 'b3' | 'b4' | 'b5' | 'enter' | 'esc';

/** Which keyboard layout a player uses. Player 1 is the original layout; player 2 (local co-op on one keyboard) gets the right-hand block:
 *  move I J K L, fast U, strong O, jump P, dash `,`, special N, defense M. */
export type Profile = 'p1' | 'p2';

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

const BINDINGS_P2: Record<Key, string[]> = {
  up: ['KeyI'],
  down: ['KeyK'],
  left: ['KeyJ'],
  right: ['KeyL'],
  b0: ['KeyP'],
  b1: ['KeyU'],
  b2: ['KeyO'],
  b3: ['Comma'],
  b4: ['KeyN'],
  b5: ['KeyM'],
  enter: [],
  esc: [],
};

const down = new Set<string>();
const tapped = new Set<string>();
let prev = new Set<string>();
let curr = new Set<string>();
let anyQueued = false;
let anyThisFrame = false;

export function attachInput(target: Window = window): () => void {
  // typing in a text field (nickname, room code) must not drive the game
  const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  const kd = (e: KeyboardEvent) => {
    if (typing(e.target)) return;
    if (!down.has(e.code)) { anyQueued = true; tapped.add(e.code); }
    down.add(e.code);
    if (e.code.startsWith('Arrow') || e.code === 'Space' || e.code === 'Enter') e.preventDefault();
  };
  const ku = (e: KeyboardEvent) => {
    if (typing(e.target)) return;
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

export function isDown(k: Key, profile: Profile = 'p1'): boolean {
  return (profile === 'p2' ? BINDINGS_P2 : BINDINGS)[k].some((c) => curr.has(c));
}
export function isPressed(k: Key, profile: Profile = 'p1'): boolean {
  return (profile === 'p2' ? BINDINGS_P2 : BINDINGS)[k].some((c) => curr.has(c) && !prev.has(c));
}
export function anyPressed(): boolean {
  return anyThisFrame;
}
