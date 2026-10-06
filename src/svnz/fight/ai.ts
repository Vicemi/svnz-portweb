// AI of svnz.exe: AIController (00423e00) + situations/reactions (AIManager 004244f0) + the data tables built by
// 0043dfc0 (research/decode_ai.py -> data/ai.json).
//
// Each fighter has a Decisions AI (what to do next: movement / waiting / picking a target) and a Reflexes AI
// (fast reactions: attack buttons when close...). An AI is a list of parts: part = situation + weight of "do
// nothing" + weighted reactions. Selection (00423a00): for every part whose situation holds, roll
// r = floor(total * rand); if r <= total - idleWeight the part fires and a reaction is chosen walking the
// weights; otherwise the next part is tried.
import aiJson from '../data/ai.json';
import type { Fighter } from './fighter';
import type { AIPad } from './pad';

type Param = ['i', number] | ['s', string];
interface Bucket { w: number; r: string; params: Param[] }
interface Part { sit: string; w: number; params: Param[]; buckets: Bucket[] }
const AIS = aiJson as unknown as Record<string, { name: string; parts: Part[] }>;

const TICK = 1 / 60;
const ARRIVE = 5;          // DAT_004f1200: goto tolerance
const Z_RANGE = 24;        // DAT_004f11fc
const ABOVE_X = 25;        // DAT_004f6bf0 / 004f1208
const AIR_Y = 50;          // DAT_004f6bf8
const AWAY_X = 100;        // DAT_004f6c00
const DECISION_MAX = 20;   // DAT_004f1224

type Mode = 0 | 1 | 2 | 3 | 4 | 5; // idle, goto, close, mid, long, wait

export class AIController {
  private decisions: Part[] | null;
  private reflexes: Part[] | null;
  private current: Bucket | null = null;
  private timer = 0;                      // +0x10
  private acc: number;                    // +0x14
  private period: number;                 // +0x18
  mode: Mode = 0;                         // +0x24
  private goal = { x: 0, z: 0 };          // +0x28..0x30
  private wait = 0;                       // +0x34

  constructor(readonly f: Fighter, readonly pad: AIPad, decisions: string, reflexes: string) {
    this.decisions = decisions && AIS[decisions] ? AIS[decisions].parts : null;
    this.reflexes = reflexes && AIS[reflexes] ? AIS[reflexes].parts : null;
    this.period = f.desc.reflexesFrequency * TICK;
    this.acc = Math.random() * this.period;
  }

  /** FUN_00423e00. */
  update(dt: number): void {
    if (this.f.target?.dead) this.f.target = null;   // Fight::v31 returns 0 for a removed id -> target reset to -1
    if (this.decisions) {
      this.timer -= dt;
      if (this.timer <= 0 || (this.current && this.finished(this.current))) this.decide();
      this.move(dt);
    }
    if (this.reflexes) {
      this.acc += dt;
      if (this.acc > this.period) {
        this.acc -= this.period;
        this.reflex();
      }
    }
  }

  private decide(): void {
    this.timer = DECISION_MAX;
    this.current = null;
    const b = this.pick(this.decisions!);
    this.current = b;
    if (b) this.exec(b);
  }

  private reflex(): void {
    const b = this.pick(this.reflexes!);
    if (!b) return;
    this.mode = 0;
    this.pad.x = 0;
    this.pad.y = 0;
    this.timer = 1;
    this.current = null;
    this.exec(b);
  }

  /** FUN_00423a00 + FUN_004257b0. */
  private pick(parts: Part[]): Bucket | null {
    const rnd = Math.random();
    for (const p of parts) {
      if (!this.situation(p)) continue;
      const total = p.w + p.buckets.reduce((s, b) => s + b.w, 0);
      let r = Math.floor(total * rnd);
      if (r <= total - p.w) {
        for (const b of p.buckets) {
          if (r <= b.w) return b;
          r -= b.w;
        }
        return p.buckets[p.buckets.length - 1] ?? null;
      }
    }
    return null;
  }

  // ------------------------------------------------------------------ situations (Fight 0x64..0xac)
  private situation(p: Part): boolean {
    const f = this.f, fight = f.fight;
    const t = f.target;
    const tOk = !!t && !t.dead;
    const close = f.desc.closeAttackDist, mid = f.desc.midAttackDist, long = f.desc.longAttackDist;
    const dzOk = (o: Fighter) => Math.abs(o.pos.z - f.pos.z) < Z_RANGE;
    switch (p.sit) {
      case 'Default': return true;
      case 'StateEquals': return f.stateName === (p.params[0]?.[1] ?? '');
      case 'HasTarget': return !!t;
      case 'TargetDead': return !t || t.life < 1;
      case 'CloseToTarget': return tOk && dzOk(t!) && Math.abs(t!.pos.x - f.pos.x) <= close + t!.desc.collisionWidth;
      case 'MidToTarget': return tOk && dzOk(t!) && Math.abs(t!.pos.x - f.pos.x) <= mid + t!.desc.collisionWidth;
      case 'LongToTarget': return tOk && dzOk(t!) && Math.abs(t!.pos.x - f.pos.x) <= long + t!.desc.collisionWidth;
      case 'CloseToAirTarget':
        return tOk && dzOk(t!) && Math.abs(t!.pos.x - f.pos.x) <= close + t!.desc.collisionWidth && t!.pos.y > AIR_Y;
      case 'AboveToTarget': return tOk && dzOk(t!) && Math.abs(t!.pos.x - f.pos.x) < ABOVE_X;
      case 'TargetIsFallingClose': return tOk && dzOk(t!) && Math.abs(t!.pos.x - f.pos.x) < ABOVE_X && t!.pos.y !== 0;
      // an enemy that has ME inside ITS attack range (closeAttackDist + my radius uses the enemy's numbers)
      case 'IsCloseToEnemy': return fight.enemiesOf(f).some((e) => dzOk(e) && Math.abs(e.pos.x - f.pos.x) <= e.desc.closeAttackDist + e.desc.collisionWidth);
      case 'MidToEnemy': return fight.enemiesOf(f).some((e) => dzOk(e) && Math.abs(e.pos.x - f.pos.x) <= e.desc.midAttackDist + e.desc.collisionWidth);
      case 'LongToEnemy': return fight.enemiesOf(f).some((e) => dzOk(e) && Math.abs(e.pos.x - f.pos.x) <= e.desc.longAttackDist + e.desc.collisionWidth);
      case 'IsCloseToAirEnemy':
        return fight.enemiesOf(f).some((e) => e.pos.y > 0 && dzOk(e) && Math.abs(e.pos.x - f.pos.x) <= e.desc.closeAttackDist + e.desc.collisionWidth);
      case 'AboveToEnemy': return fight.enemiesOf(f).some((e) => dzOk(e) && Math.abs(e.pos.x - f.pos.x) <= ABOVE_X);
    }
    return false;
  }

  // ------------------------------------------------------------------ reactions (IAIFighter slots)
  private exec(b: Bucket): void {
    const f = this.f, fight = f.fight;
    const iparam = b.params.find((p) => p[0] === 'i')?.[1] ?? 0;
    switch (b.r) {
      case 'Wait': this.mode = 5; this.wait = iparam * TICK; this.pad.x = this.pad.y = 0; break;
      case 'RandomWalk': this.goto(fight.randomPos(f)); break;
      case 'CloseToTarget': this.follow(2); break;
      case 'MidToTarget': this.follow(3); break;
      case 'LongToTarget': this.follow(4); break;
      case 'AboveToTarget': if (f.target) this.goto({ x: f.target.pos.x, z: f.target.pos.z }); break;
      case 'StalkTarget': if (f.target) this.goto(this.stalkPos(f.target)); break;
      case 'StayAway': if (f.target) this.goto(this.awayPos(f.target)); break;
      case 'FindNewTargetRandom': f.target = fight.randomEnemy(f); break;
      case 'FindClosestTarget': f.target = fight.closestEnemy(f); break;
      case 'FindStrongTarget': f.target = fight.strongEnemy(f); break;
      case 'FindWeakTarget': f.target = fight.weakEnemy(f); break;
      case 'PressButton': this.pad.tap(iparam); break;
      case 'PressButtonAimingToTarget': this.aimPress(iparam); break;
    }
  }

  /** The reaction is over: movement reactions when the fighter stops, waits/follows when the controller is idle,
   *  find/press reactions immediately (v2 of each reaction class). */
  private finished(b: Bucket): boolean {
    switch (b.r) {
      case 'Wait': case 'CloseToTarget': case 'MidToTarget': case 'LongToTarget': return this.mode === 0;
      case 'AboveToTarget': case 'RandomWalk': case 'StalkTarget': case 'StayAway': {
        const v = this.f.vel;
        return v.x === 0 && v.y === 0 && v.z === 0;
      }
    }
    return true;
  }

  private goto(g: { x: number; z: number }): void {
    this.mode = 1;
    this.goal = this.f.fight.clampPos(g.x, g.z, this.f.desc.collisionWidth);
  }

  private follow(mode: 2 | 3 | 4): void {
    if (!this.f.target) this.f.target = this.f.fight.randomEnemy(this.f);
    this.mode = mode;
  }

  /** Fight::v44 (0041f3f0): a point beside the target on the side I already am, 30..90 deep, up to 110 apart. */
  private stalkPos(t: Fighter): { x: number; z: number } {
    const f = this.f;
    const dz = Math.floor(Math.random() * 61) + 30;
    const z = t.pos.z <= f.pos.z ? t.pos.z + dz : t.pos.z - dz;
    const dx = Math.floor(Math.random() * 111);
    const x = t.pos.x <= f.pos.x ? t.pos.x + dx : t.pos.x - dx;
    return { x, z };
  }

  /** Fight::v38 (0041e140): a random position at least 100 px from the target (kept trying). */
  private awayPos(t: Fighter): { x: number; z: number } {
    let p = this.f.fight.randomPos(this.f);
    for (let i = 0; i < 25 && Math.abs(p.x - t.pos.x) < AWAY_X && t.pos.y < AIR_Y; i++) p = this.f.fight.randomPos(this.f);
    return p;
  }

  /** Fighter::v25 (00409730): push the stick toward the target (so the new state turns to it) and press. */
  private aimPress(btn: number): void {
    const t = this.f.target;
    if (t) {
      const f = this.f;
      if (t.pos.x <= f.pos.x) { if (f.facing === 1) this.pad.x = -1; }
      else if (f.facing === -1) this.pad.x = 1;
    }
    this.pad.tap(btn);
  }

  // ------------------------------------------------------------------ movement (FUN_00423fe0)
  private move(dt: number): void {
    const f = this.f;
    switch (this.mode) {
      case 1: this.step(); break;
      case 2: case 3: case 4: {
        const t = f.target;
        if (!t) { this.stop(); break; }
        const dist = this.mode === 2 ? f.desc.closeAttackDist : this.mode === 3 ? f.desc.midAttackDist : f.desc.longAttackDist;
        // the nearer of the two spots at `dist` on either side of the target, same depth
        const l = { x: t.pos.x - dist, z: t.pos.z }, r = { x: t.pos.x + dist, z: t.pos.z };
        const dl = Math.hypot(l.x - f.pos.x, l.z - f.pos.z), dr = Math.hypot(r.x - f.pos.x, r.z - f.pos.z);
        this.goal = f.fight.clampPos((dl < dr ? l : r).x, t.pos.z, f.desc.collisionWidth);
        this.step();
        break;
      }
      case 5:
        this.wait -= dt;
        if (this.wait <= 0) { this.wait = 0; this.stop(); }
        break;
    }
  }

  /** FUN_00424090: stick toward the goal, stop when within 5 px on both axes. */
  private step(): void {
    const f = this.f;
    const dx = this.goal.x - f.pos.x, dz = this.goal.z - f.pos.z;
    if (Math.abs(dx) >= ARRIVE || Math.abs(dz) >= ARRIVE) {
      const len = Math.hypot(dx, dz);
      this.pad.x = dx / len;
      this.pad.y = dz / len;
    } else this.stop();
  }

  private stop(): void {
    this.mode = 0;
    this.pad.x = 0;
    this.pad.y = 0;
  }
}
