// IGamePad: UserPad (keyboard, 00419b40/00419e40) and GamePadAI (driven by the AI controller).
import { isDown, isPressed, type Key } from '../core/input';

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
const DOUBLE_WINDOW = 0.2;   // +0x34
const BASH_MAX = 10;         // +0x38
const BASH_ADD = 1;          // +0x3c
const DOUBLE_TIME = 0.3;     // +0x40
const BASH_DECAY = 15;       // DAT_004f6c20 per second

export class UserPad implements Pad {
  x = 0;
  y = 0;
  bash = 0;
  lockTarget = false;
  private tapWindow = [0, 0, 0, 0];   // right, left, up, down
  private dbl = [0, 0, 0, 0];
  private dashDbl = 0;                 // +0x78 dash button acts as a double tap

  update(dt: number): void {
    if (this.bash > 0) this.bash = Math.max(0, this.bash - dt * BASH_DECAY);
    this.x = (isDown('right') ? 1 : 0) - (isDown('left') ? 1 : 0);
    this.y = (isDown('down') ? 1 : 0) - (isDown('up') ? 1 : 0);
    const dirs: Key[] = ['right', 'left', 'up', 'down'];
    dirs.forEach((k, i) => {
      this.dbl[i] = Math.max(0, this.dbl[i] - dt);
      if (isPressed(k)) {
        if (this.tapWindow[i] > 0) this.dbl[i] = DOUBLE_TIME;
        this.tapWindow[i] = DOUBLE_WINDOW;
        this.bash = Math.min(BASH_MAX, this.bash + BASH_ADD);
      }
      if (this.tapWindow[i] > 0) this.tapWindow[i] = Math.max(0, this.tapWindow[i] - dt);
    });
    if (this.dashDbl > 0) this.dashDbl = Math.max(0, this.dashDbl - dt);
    BTN.forEach((k, i) => {
      if (isPressed(k)) {
        this.bash = Math.min(BASH_MAX, this.bash + BASH_ADD);
        if (i === 3) this.dashDbl = DOUBLE_TIME;
      }
    });
  }
  pressed(b: number): boolean { return b >= 0 && b < 6 && isPressed(BTN[b]); }
  down(b: number): boolean { return b >= 0 && b < 6 && isDown(BTN[b]); }
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
