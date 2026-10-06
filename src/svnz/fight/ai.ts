// AI controller. TODO(MODLOG): replace with the decoded Standar/BigDemon/Dracula decisions + reflexes tables
// (AIManager builder 0043dfc0). This first version approaches the target and attacks at its attack distances.
import type { Fighter } from './fighter';
import type { AIPad } from './pad';

export class SimpleAI {
  private think = 0;
  private wantX = 0;
  private wantY = 0;

  constructor(readonly f: Fighter, readonly pad: AIPad, readonly passive = false) {}

  update(dt: number): void {
    const f = this.f, pad = this.pad;
    this.think -= dt;
    const t = f.fight.nearestEnemy(f);
    if (!t || t.life <= 0) { pad.x = pad.y = 0; return; }
    const dx = t.pos.x - f.pos.x, dz = t.pos.z - f.pos.z;
    const adx = Math.abs(dx);
    if (this.think <= 0) {
      this.think = Math.max(0.05, f.desc.reflexesFrequency / 60) * (0.5 + Math.random());
      const close = f.desc.closeAttackDist + 10;
      this.wantX = adx > close ? Math.sign(dx) : (adx < close * 0.5 ? -Math.sign(dx) * 0.5 : 0);
      this.wantY = Math.abs(dz) > 6 ? Math.sign(dz) : 0;
      if (!this.passive && adx <= f.desc.midAttackDist && Math.abs(dz) < 12) {
        const r = Math.random();
        if (adx <= close) pad.tap(r < 0.7 ? 1 : r < 0.9 ? 2 : 0);
        else if (r < 0.25) pad.tap(2);
        if (f.desc.dataKey === 'Dracula' && r < 0.15) pad.tap(4);
      }
      if (this.passive) { this.wantX = adx > 80 ? Math.sign(dx) * 0.5 : 0; }
    }
    pad.x = this.wantX;
    pad.y = this.wantY;
    if (this.wantX === 0 && adx > 1) {
      // keep facing the target while idle
      f.facing = dx > 0 ? 1 : -1;
    }
  }
}
