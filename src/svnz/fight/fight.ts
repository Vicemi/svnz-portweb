// Fight (svnz.exe Fight/FightersManager/CollisionsManager/WavesManager): fighters, hit detection, sparks,
// slow motion, shakes and the wave flow of each game mode.
import { Fighter, CHARS, type Spark, type Clone } from './fighter';
import { DB, makeDesc, type FighterSpec, type LevelDef, type WaveDef } from './data';
import { AIPad, UserPad } from './pad';
import { SimpleAI } from './ai';
import { playMusic, playSound } from '../core/audio';

export interface Area { x0: number; z0: number; w: number; d: number }

/** FightingArea dojo/arena/practice (0041dd90): x 0..480, z 60..220; dungeon (0041de10) differs only in art. */
export const AREA: Area = { x0: 0, z0: 60, w: 480, d: 160 };

export type Phase = 'intro' | 'ready' | 'fight' | 'cleared' | 'failed' | 'done';

export class Fight {
  fighters: Fighter[] = [];
  sparks: Spark[] = [];
  clones: (Clone & { char: string })[] = [];
  area = AREA;
  time = 0;
  slow = { rate: 1, t: 0 };
  shake = { amp: 0, t: 0 };
  protag: { f: Fighter; t: number } | null = null;
  players: Fighter[] = [];

  level: LevelDef;
  waveIdx = 0;
  wave: WaveDef | null = null;
  phase: Phase = 'intro';
  phaseT = 0;
  banner = '';
  bannerT = 0;
  queue: FighterSpec[] = [];
  queuePos = 0;
  extrasQueue: FighterSpec[] = [];
  extrasPos = 0;
  boss: Fighter | null = null;
  count = 0;            // enemies defeated
  record = 0;
  /** Fight::v10 (00420cd0): the human's combo (hits, window, remaining). Window 1 s for the first hit, growing to
   *  2.2 s at 20 hits (DAT_004f1218); the bar shows remaining/window. */
  combo = { hits: 0, window: 0, left: 0 };
  /** Enemy shown in the bottom-right life bar: the last one the human hit (Fight +0x3d0). */
  target: Fighter | null = null;
  timeLeft = 0;
  spawnTimer = 0;
  finished = false;
  won = false;

  constructor(readonly levelKey: string) {
    this.level = DB.levels[levelKey];
    const team = DB.lists[this.level.playerTeam];
    team.fighters.forEach((spec, i) => {
      const desc = makeDesc(spec);
      const human = i === 0;
      const f = new Fighter(desc, this, { cpu: !human, team: team.team, color: desc.color, life: human ? undefined : parseInt(spec.attrs.lifeCPU ?? '', 10) || desc.lifeCPU });
      f.usesPower = human;          // only the human gets a power meter (004205c0), starting at 250
      f.power = human ? 250 : 0;
      if (human) f.pad = new UserPad();
      else { const p = new AIPad(); f.pad = p; f.ai = new SimpleAI(f, p); }
      this.place(f, spec.yPos);
      f.changeState(spec.state ?? desc.state);
      this.fighters.push(f);
      this.players.push(f);
    });
    this.startWave(0);
  }

  // ------------------------------------------------------------------ waves
  startWave(i: number): void {
    this.waveIdx = i;
    const lw = this.level.waves[i];
    this.wave = DB.waves[lw.name];
    this.queue = DB.lists[this.wave.list]?.fighters ?? [];
    this.queuePos = 0;
    this.extrasQueue = this.wave.listExtras ? DB.lists[this.wave.listExtras]?.fighters ?? [] : [];
    this.extrasPos = 0;
    this.boss = null;
    this.timeLeft = this.wave.time;
    this.phase = 'intro';
    this.phaseT = 0;
    this.banner = lw.initialTextKey;
    this.bannerT = 2;
    const music = lw.music ?? this.level.music;
    if (music && music !== 'NONE') playMusic(music);
  }

  private enemies(): Fighter[] { return this.fighters.filter((f) => !this.players.includes(f) && !f.dead); }

  private spawn(spec: FighterSpec, team: number, asBoss: boolean): Fighter {
    const desc = makeDesc(spec);
    const life = parseInt(spec.attrs.lifeCPU ?? '', 10) || desc.lifeCPU;
    const f = new Fighter(desc, this, { cpu: true, team, color: desc.color, life });
    const p = new AIPad();
    f.pad = p;
    if (spec.attrs.reflexesAI !== '' || true) f.ai = new SimpleAI(f, p, spec.attrs.reflexesAI === '');
    f.evil = team === 2;
    f.boss = asBoss;
    this.place(f, spec.yPos);
    f.changeState(spec.state ?? desc.state);
    this.fighters.push(f);
    return f;
  }

  /** Fight::v30 (0041e2a0): random z in the area, random x keeping 1.2 x collisionWidth from the walls;
   *  FighterLoader picks a random facing. */
  private place(f: Fighter, y?: number): void {
    const ar = this.area;
    const m = f.desc.collisionWidth * 1.2;
    const z = ar.z0 + Math.random() * ar.d;
    const x = ar.x0 + m + Math.random() * (ar.w - 2 * m);
    f.pos = { x, y: y ?? 0, z };
    f.facing = Math.random() < 0.5 ? -1 : 1;
  }

  private waveUpdate(dt: number): void {
    const w = this.wave!;
    const lw = this.level.waves[this.waveIdx];
    this.phaseT += dt;
    if (this.bannerT > 0) this.bannerT -= dt;
    if (this.phase === 'intro' && this.phaseT > 2) {
      this.phase = 'ready';
      this.phaseT = 0;
      this.banner = lw.startTextKey;
      this.bannerT = 1;
    } else if (this.phase === 'ready' && this.phaseT > 1) {
      this.phase = 'fight';
      this.phaseT = 0;
    } else if (this.phase === 'fight') {
      const team = DB.lists[w.list]?.team ?? 2;
      const alive = this.enemies();
      if (w.mode === 'BossMode') {
        if (!this.boss && this.queuePos < this.queue.length) this.boss = this.spawn(this.queue[this.queuePos++], team, true);
        const extras = alive.filter((f) => f !== this.boss);
        if (this.boss && !this.boss.dead && extras.length < w.activeExtras && this.extrasQueue.length) {
          this.spawnTimer -= dt;
          if (this.spawnTimer <= 0) {
            this.spawn(this.extrasQueue[this.extrasPos % this.extrasQueue.length], team, false);
            this.extrasPos++;
            this.spawnTimer = 1;
          }
        }
        if (this.boss && this.boss.dead) this.clear();
      } else {
        const loops = w.mode === 'TimeMode' || w.mode === 'SurvivalMode';
        if (alive.length < w.activeEnemies && (loops || this.queuePos < this.queue.length)) {
          this.spawnTimer -= dt;
          if (this.spawnTimer <= 0) {
            if (this.queuePos >= this.queue.length) this.queuePos = Math.min(w.loopIndex, this.queue.length - 1);
            this.spawn(this.queue[this.queuePos++], team, false);
            this.spawnTimer = 0.6;
          }
        }
        if (!loops && this.queuePos >= this.queue.length && alive.length === 0) this.clear();
        if (w.mode === 'TimeMode') {
          this.timeLeft -= dt;
          if (this.timeLeft <= 0) { this.timeLeft = 0; this.clear(); }
        }
      }
      if (this.players.some((p) => p.dead || p.life === 0 && p.stateName === 'Dead')) {
        if (this.players.some((p) => p.dead)) this.fail();
      }
    } else if (this.phase === 'cleared' && this.phaseT > 3) {
      if (this.waveIdx + 1 < this.level.waves.length) this.startWave(this.waveIdx + 1);
      else { this.phase = 'done'; this.finished = true; this.won = true; }
    } else if (this.phase === 'failed' && this.phaseT > 4) {
      this.phase = 'done';
      this.finished = true;
    }
  }

  private clear(): void {
    this.phase = 'cleared';
    this.phaseT = 0;
    this.banner = this.level.waves[this.waveIdx].finalTextKey;
    this.bannerT = 3;
    for (const e of this.enemies()) if (e.life > 0) { e.damage(e.life, true); }
  }
  private fail(): void {
    this.phase = 'failed';
    this.phaseT = 0;
    this.banner = this.level.waves[this.waveIdx].failTextKey;
    this.bannerT = 4;
  }

  // ------------------------------------------------------------------ manager hooks used by fighters
  nearestEnemy(f: Fighter): Fighter | null {
    let best: Fighter | null = null, bd = Infinity;
    for (const o of this.fighters) {
      if (o === f || o.dead || o.team === f.team) continue;
      const d = Math.abs(o.pos.x - f.pos.x) + Math.abs(o.pos.z - f.pos.z);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }
  killFighter(f: Fighter): void {
    if (f.dead) return;
    f.dead = true;
    if (!this.players.includes(f)) {
      this.count++;
      if (this.count > this.record) this.record = this.count;
    }
  }
  lifeEnabled(_f: Fighter): boolean { return this.levelKey !== 'practiceLevel' || this.players.includes(_f); }
  protagonism(f: Fighter, t: number): void { this.protag = { f, t }; }
  shakeGround(amp: number, ticks: number): void { this.shake = { amp, t: ticks / 60 }; }
  shakeWalls(amp: number, ticks: number): void { this.shake = { amp, t: ticks / 60 }; }
  slowMotion(rate: number, t: number): void { this.slow = { rate, t }; }

  addSpark(id: number, x: number, y: number, z: number, facing: number): void {
    const a = CHARS.Effects.anims[String(id)];
    if (!a) return;
    this.sparks.push({ anim: a, id, frame: 0, t: 0, x, y, z, facing, done: false });
  }

  // ------------------------------------------------------------------ update
  update(dt: number): void {
    this.time += dt;
    this.waveUpdate(dt);
    let fdt = dt;
    if (this.slow.t > 0) {
      this.slow.t -= dt;
      fdt = dt * this.slow.rate;
    }
    if (this.protag) { this.protag.t -= dt; if (this.protag.t <= 0) this.protag = null; }
    if (this.shake.t > 0) this.shake.t -= dt;
    for (const f of this.fighters) {
      if (f.dead) continue;
      if (f.ai && this.phase === 'fight') f.ai.update(fdt);
      f.update(fdt);
    }
    this.collide();
    for (const s of this.sparks) {
      s.t += fdt;
      while (!s.done && s.t >= s.anim.frames[s.frame].t / 60) {
        s.t -= s.anim.frames[s.frame].t / 60;
        s.frame++;
        if (s.frame >= s.anim.frames.length) { s.done = true; s.frame = s.anim.frames.length - 1; }
      }
    }
    this.sparks = this.sparks.filter((s) => !s.done);
    if (this.combo.hits > 0) {
      this.combo.left -= fdt;
      if (this.combo.left <= 0) this.combo = { hits: 0, window: 0, left: 0 };
    }
    if (this.target && this.target.dead) this.target = null;
    for (const c of this.clones) c.life -= fdt;
    this.clones = this.clones.filter((c) => c.life > 0);
    this.fighters = this.fighters.filter((f) => !f.dead || this.players.includes(f));
  }

  /** CollisionsManager (004368a0 / 00436970 / 00436ae0). */
  private collide(): void {
    const fs = this.fighters.filter((f) => !f.dead);
    for (let i = 0; i < fs.length; i++) {
      for (let j = i + 1; j < fs.length; j++) {
        const a = fs[i], b = fs[j];
        const ra = this.check(a, b), rb = this.check(b, a);
        if (ra && rb) {
          const pa = a.hit!.priority, pb = b.hit!.priority;
          if (pa === pb) { this.apply(a, b, ra); this.apply(b, a, rb); }
          else if (pa > pb) this.apply(a, b, ra);
          else this.apply(b, a, rb);
        } else if (ra) this.apply(a, b, ra);
        else if (rb) this.apply(b, a, rb);
      }
    }
  }
  private apply(att: Fighter, vic: Fighter, r: [number, number, number, number]): void {
    const h = att.hit!;
    att.hitVictims.add(vic.uid);
    vic.receiveHit(h, att);
    att.hitConnect(h, r, vic);
    if (att === this.players[0] && vic.team !== att.team) {
      this.target = vic;
      const c = this.combo;
      c.hits++;
      c.window = c.hits === 1 ? 1 : 1 + 1.2 * Math.min(1, c.hits / 20);
      c.left = c.window;
    }
  }
  /** Does `a`'s current hit reach `b`? Returns the intersection rect. */
  private check(a: Fighter, b: Fighter): [number, number, number, number] | null {
    if (!a.isAttacking() || a.pause > 0) return null;
    if (a.hitVictims.has(b.uid) || !b.canBeHit()) return null;
    const h = a.hit!;
    switch (h.target) {
      case 31: if (a.team === b.team) return null; break;
      case 32: if (a.team !== b.team) return null; break;
      case 33: break;
      default: if (a.team === b.team) return null;
    }
    if (!a.zDistanceOk(b)) return null;
    for (const ra of a.rects('hit')) {
      for (const rb of b.rects('body')) {
        const x1 = Math.max(ra[0], rb[0]), y1 = Math.max(ra[1], rb[1]);
        const x2 = Math.min(ra[0] + ra[2], rb[0] + rb[2]), y2 = Math.min(ra[1] + ra[3], rb[1] + rb[3]);
        if (x1 < x2 && y1 < y2) return [x1, y1, x2 - x1, y2 - y1];
      }
    }
    return null;
  }

  playerLife(): number { return this.players[0]?.life ?? 0; }
}

export { playSound };
