// IGamePad: UserPad (keyboard, 00419b40/00419e40) and GamePadAI (driven by the AI controller).
import { isDown, isPressed, type Key, type Profile } from '../core/input';

export interface Pad {
  x: number;              // stick -1..1 (right +)
  y: number;              // stick -1..1 (down + = toward the camera)
  bash: number;
  lockTarget: boolean;
  update(dt: number): void;
  pressed(b: number): boolean;
  down(b: number): boolean;
  doubleRight(): boolean;
  doubleLeft(): boolean;
}

const BTN: Key[] = ['b0', 'b1', 'b2', 'b3', 'b4', 'b5'];

/** Where a human pad reads its buttons from: a keyboard layout, or the controller state a remote player sent over the network. */
export interface KeySource {
  down(k: Key): boolean;
  pressed(k: Key): boolean;
}
export const keyboard = (profile: Profile = 'p1'): KeySource => ({ down: (k) => isDown(k, profile), pressed: (k) => isPressed(k, profile) });

/** Controller state on the wire: bit i of the masks = KEY_BITS[i] (held / pressed since the last packet). */
export const KEY_BITS: Key[] = ['up', 'down', 'left', 'right', 'b0', 'b1', 'b2', 'b3', 'b4', 'b5'];
export interface PadState { m: number; tp: number }

/** Samples a keyboard layout into the wire format (guest side): `m` = held now, `tp` = pressed since last call. */
export class PadSampler {
  private tp = 0;
  constructor(private src: KeySource = keyboard('p1')) {}
  /** call once per fixed update */
  sample(): void { KEY_BITS.forEach((k, i) => { if (this.src.pressed(k)) this.tp |= 1 << i; }); }
  /** held buttons right now / a press waiting to be sent */
  mask(): number { let m = 0; KEY_BITS.forEach((k, i) => { if (this.src.down(k)) m |= 1 << i; }); return m; }
  hasTap(): boolean { return this.tp !== 0; }
  take(): PadState {
    let m = 0;
    KEY_BITS.forEach((k, i) => { if (this.src.down(k)) m |= 1 << i; });
    const out = { m, tp: this.tp | 0 };
    this.tp = 0;
    return out;
  }
}

/** KeySource fed by packets of a remote player (host side). A tap that came and went between two packets still counts as pressed. */
export class RemoteSource implements KeySource {
  private m = 0;
  private prev = 0;
  private tp = 0;
  set(s: PadState): void { this.m = s.m | 0; this.tp |= s.tp | 0; }
  down(k: Key): boolean { const i = KEY_BITS.indexOf(k); return i >= 0 && (this.m & (1 << i)) !== 0; }
  pressed(k: Key): boolean {
    const i = KEY_BITS.indexOf(k);
    if (i < 0) return false;
    const bit = 1 << i;
    return (this.tp & bit) !== 0 || ((this.m & bit) !== 0 && (this.prev & bit) === 0);
  }
  /** call after every fighter update */
  endTick(): void { this.prev = this.m; this.tp = 0; }
  release(): void { this.m = 0; this.tp = 0; }
}
const DOUBLE_WINDOW = 0.2;   // +0x34
const BASH_MAX = 10;         // +0x38
const BASH_ADD = 1;          // +0x3c
const DOUBLE_TIME = 0.3;     // +0x40
const BASH_DECAY = 15;       // DAT_004f6c20 per second

export class UserPad implements Pad {
  constructor(private src: KeySource = keyboard('p1')) {}
  x = 0;
  y = 0;
  bash = 0;
  lockTarget = false;
  private tapWindow = [0, 0, 0, 0];   // right, left, up, down
  private dbl = [0, 0, 0, 0];
  private dashDbl = 0;                 // +0x78 dash button acts as a double tap

  update(dt: number): void {
    if (this.bash > 0) this.bash = Math.max(0, this.bash - dt * BASH_DECAY);
    this.x = (this.src.down('right') ? 1 : 0) - (this.src.down('left') ? 1 : 0);
    this.y = (this.src.down('down') ? 1 : 0) - (this.src.down('up') ? 1 : 0);
    const dirs: Key[] = ['right', 'left', 'up', 'down'];
    dirs.forEach((k, i) => {
      this.dbl[i] = Math.max(0, this.dbl[i] - dt);
      if (this.src.pressed(k)) {
        if (this.tapWindow[i] > 0) this.dbl[i] = DOUBLE_TIME;
        this.tapWindow[i] = DOUBLE_WINDOW;
        this.bash = Math.min(BASH_MAX, this.bash + BASH_ADD);
      }
      if (this.tapWindow[i] > 0) this.tapWindow[i] = Math.max(0, this.tapWindow[i] - dt);
    });
    if (this.dashDbl > 0) this.dashDbl = Math.max(0, this.dashDbl - dt);
    BTN.forEach((k, i) => {
      if (this.src.pressed(k)) {
        this.bash = Math.min(BASH_MAX, this.bash + BASH_ADD);
        if (i === 3) this.dashDbl = DOUBLE_TIME;
      }
    });
  }
  pressed(b: number): boolean { return b >= 0 && b < 6 && this.src.pressed(BTN[b]!); }
  down(b: number): boolean { return b >= 0 && b < 6 && this.src.down(BTN[b]!); }
  doubleRight(): boolean { return this.dbl[0] > 0 || (this.dashDbl > 0 && this.down(3)); }
  doubleLeft(): boolean { return this.dbl[1] > 0 || (this.dashDbl > 0 && this.down(3)); }
}

/** Pad written by the AI each update: `press` lasts one update, `hold` while set. */
export class AIPad implements Pad {
  x = 0;
  y = 0;
  bash = 0;
  lockTarget = true;
  private press = new Set<number>();
  private next = new Set<number>();
  hold = new Set<number>();
  dblR = 0;
  dblL = 0;

  update(dt: number): void {
    this.press = this.next;
    this.next = new Set();
    this.dblR = Math.max(0, this.dblR - dt);
    this.dblL = Math.max(0, this.dblL - dt);
  }
  tap(b: number): void { this.next.add(b); }
  pressed(b: number): boolean { return this.press.has(b); }
  down(b: number): boolean { return this.hold.has(b) || this.press.has(b); }
  doubleRight(): boolean { return this.dblR > 0; }
  doubleLeft(): boolean { return this.dblL > 0; }
}
