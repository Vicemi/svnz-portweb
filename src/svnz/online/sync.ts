// Network state of a fight. The host simulates and calls makeSnap() 30 times a second; guests keep a "mirror" Fight that only shows
// what the snapshots say (positions are interpolated between two snapshots, animations / sparks / sounds / HUD numbers are copied).
import { CHARS, Fighter, type Spark } from '../fight/fighter';
import { Fight, type Phase } from '../fight/fight';
import { makeDesc } from '../fight/data';
import { playMusic, playSound } from '../core/audio';
import type { ItemKey } from './items';

export interface FSnap {
  u: number;        // uid
  k: string;        // character (characters.xml key)
  s: number;        // palette / sheet
  tm: number;       // team
  n: string;        // name shown above / in the life bar
  sl: number;       // player slot (-1 = CPU)
  x: number; y: number; z: number;
  f: number;        // facing
  a: number;        // animation id
  r: number;        // frame
  l: number; m: number;   // life, max life
  p: number;        // power
  b: number;        // flags: 1 blink, 2 blinkOn, 4 hidden, 8 dead, 16 shake, 32 stars, 64 guard, 128 eliminated (VS)
  sk: number;       // VS lives left
  bf: number;       // power-ups: 1 speed, 2 shield, 4 damage, 8 life steal
  bt: number[];     // seconds left of: speed, shield, damage, life steal, stars
}
export interface PSnap { u: number; h: number; w: number; e: number; tg: number }
export interface Snap {
  q: number;
  tm: number;
  ph: Phase; wi: number; bn: string; bt: number; cnt: number; tl: number; mu: string;
  sh: number;
  fs: FSnap[];
  pl: PSnap[];
  /** power-ups on the map: type, x, z, seconds left */
  it: [string, number, number, number][];
  /** VS lives each player started with */
  lv: number;
  /** things in flight (thrown stars, XA shots): char sheet ('' = XaFx), animation, x, y, z, vx, vy, vz, age */
  pj: [string, number, number, number, number, number, number, number, number][];
  sp: [string, number, number, number, number, number][];
  snd: [string, number][];
  fin: number; res: number; won: number;
}

const r1 = (v: number) => Math.round(v * 10) / 10;

export function makeSnap(fight: Fight, seq: number, sounds: [string, number][]): Snap {
  const fs: FSnap[] = fight.fighters.map((f) => ({
    u: f.uid, k: f.desc.key, s: f.sheet, tm: f.team, n: f.name, sl: f.slot,
    x: r1(f.pos.x), y: r1(f.pos.y), z: r1(f.pos.z), f: f.facing,
    a: f.anim.id, r: f.anim.frame,
    l: Math.round(f.life), m: f.lifeMax, p: Math.round(f.power),
    b: (f.blink ? 1 : 0) | (f.blinkOn ? 2 : 0) | (f.hidden ? 4 : 0) | (f.dead ? 8 : 0) | (f.shake.on ? 16 : 0) | (f.stars > 0 ? 32 : 0) | (f.guard ? 64 : 0) | (f.out ? 128 : 0),
    bt: [f.buff.speed, f.buff.shield, f.buff.power, f.buff.fang, f.stars].map((v) => Math.round(v * 10) / 10),
    sk: f.stocks, bf: (f.buff.speed > 0 ? 1 : 0) | (f.buff.shield > 0 ? 2 : 0) | (f.buff.power > 0 ? 4 : 0) | (f.buff.fang > 0 ? 8 : 0),
  }));
  const pl: PSnap[] = fight.players.map((p) => ({ u: p.uid, h: p.combo.hits, w: r1(p.combo.window), e: r1(p.combo.left), tg: p.comboTarget ? p.comboTarget.uid : 0 }));
  const sp = fight.sparkLog.splice(0).map((s) => [s.char, s.id, r1(s.x), r1(s.y), r1(s.z), s.facing] as [string, number, number, number, number, number]);
  return {
    q: seq, tm: r1(fight.time), ph: fight.phase, wi: fight.waveIdx, bn: fight.banner, bt: r1(fight.bannerT), cnt: fight.count, tl: r1(fight.timeLeft),
    mu: fight.musicKey, sh: fight.shake.t > 0 ? fight.shake.amp : 0, fs, pl, it: fight.items.map((i) => [i.type, r1(i.x), r1(i.z), r1(i.t)] as [string, number, number, number]), lv: fight.maxStocks,
    pj: fight.projectiles.filter((p) => p.t < 90).map((p) => [p.char ?? '', p.anim, r1(p.x), r1(p.y), r1(p.z), Math.round(p.vx), Math.round(p.vy), Math.round(p.vz), r1(p.t)] as [string, number, number, number, number, number, number, number, number]), sp, snd: sounds.splice(0),
    fin: fight.finished ? 1 : 0, res: fight.result ? fight.result.winner : -1, won: fight.won ? 1 : 0,
  };
}

interface Lerp { fx: number; fy: number; fz: number; tx: number; ty: number; tz: number; t: number }
const SNAP_INTERVAL = 1 / 30;

/** Guest side: a Fight that mirrors the host's snapshots. */
export class Mirror {
  readonly fight: Fight;
  private byUid = new Map<number, Fighter>();
  private lerp = new Map<number, Lerp>();
  lastSeq = -1;
  lastAt = 0;

  constructor(levelKey: string, mode: 'coop' | 'vs', private localId: number) {
    this.fight = new Fight(levelKey, undefined, true);
    this.fight.mode = mode;
    this.fight.wave = null;
  }

  apply(s: Snap): void {
    if (s.q <= this.lastSeq) return;   // out of order or duplicate
    this.lastSeq = s.q;
    this.lastAt = performance.now();
    const F = this.fight;
    const seen = new Set<number>();
    for (const e of s.fs) {
      seen.add(e.u);
      let f = this.byUid.get(e.u);
      if (!f) {
        const desc = makeDesc({ type: e.k, nameIndex: 0, attrs: { color: String(e.s) } });
        f = new Fighter(desc, F, { cpu: e.sl < 0, team: e.tm, color: e.s });
        f.sheet = e.s;
        this.byUid.set(e.u, f);
        this.lerp.set(e.u, { fx: e.x, fy: e.y, fz: e.z, tx: e.x, ty: e.y, tz: e.z, t: 1 });
        f.pos = { x: e.x, y: e.y, z: e.z };
        F.fighters.push(f);
      } else {
        const l = this.lerp.get(e.u)!;
        const far = Math.hypot(e.x - f.pos.x, e.z - f.pos.z) > 90 || Math.abs(e.y - f.pos.y) > 90;
        l.fx = far ? e.x : f.pos.x; l.fy = far ? e.y : f.pos.y; l.fz = far ? e.z : f.pos.z;
        l.tx = e.x; l.ty = e.y; l.tz = e.z; l.t = 0;
      }
      f.name = e.n;
      f.slot = e.sl;
      f.nick = e.sl >= 0 ? e.n : '';
      f.team = e.tm;
      f.facing = e.f;
      f.lifeMax = e.m;
      f.life = e.l;
      f.power = e.p;
      f.usesPower = e.sl >= 0;
      f.blink = !!(e.b & 1);
      f.blinkOn = !!(e.b & 2);
      f.hidden = !!(e.b & 4);
      f.dead = !!(e.b & 8);
      f.shake.on = !!(e.b & 16);
      f.shake.amp = 1;
      f.guard = !!(e.b & 64);
      f.out = !!(e.b & 128);
      f.stocks = e.sk;
      f.buff = { speed: e.bt[0] ?? 0, shield: e.bt[1] ?? 0, power: e.bt[2] ?? 0, fang: e.bt[3] ?? 0 };
      f.stars = e.bt[4] ?? 0;
      if (f.anim.id !== e.a) {
        const an = f.sprites.anims[String(e.a)];
        if (an) { f.anim.anim = an; f.anim.id = e.a; }
      }
      if (f.anim.anim) f.anim.frame = Math.max(0, Math.min(e.r, f.anim.anim.frames.length - 1));
    }
    for (const [u, f] of this.byUid) {
      if (!seen.has(u)) {
        this.byUid.delete(u);
        this.lerp.delete(u);
        F.fighters = F.fighters.filter((o) => o !== f);
      }
    }
    // players in slot order, with their combo counters
    const order = s.pl.map((p) => this.byUid.get(p.u)).filter((f): f is Fighter => !!f);
    F.players = order;
    F.humans = order;
    F.local = order.find((f) => f.slot === this.localId) ?? order[0] ?? F.local;
    for (const p of s.pl) {
      const f = this.byUid.get(p.u);
      if (!f) continue;
      f.combo = { hits: p.h, window: p.w, left: p.e };
      f.comboTarget = p.tg ? this.byUid.get(p.tg) ?? null : null;
    }
    F.time = s.tm;
    F.phase = s.ph;
    F.waveIdx = s.wi;
    F.banner = s.bn;
    F.bannerT = s.bt;
    F.count = s.cnt;
    F.timeLeft = s.tl;
    F.shake = { amp: s.sh, t: s.sh > 0 ? 0.1 : 0 };
    F.items = s.it.map(([type, x, z, t]) => ({ type: type as ItemKey, x, z, t }));
    F.maxStocks = s.lv;
    F.projectiles = s.pj.map(([char, anim, x, y, z, vx, vy, vz, t]) => ({ char: char || undefined, anim, x, y, z, vx, vy, vz, t, hit: '', owner: F.players[0] })) as unknown as typeof F.projectiles;
    F.finished = !!s.fin;
    F.result = s.res >= 0 ? { winner: s.res } : null;
    F.won = !!s.won;
    for (const [char, id, x, y, z, facing] of s.sp) {
      const a = CHARS[char]?.anims[String(id)];
      if (a) F.sparks.push({ char, anim: a, id, frame: 0, t: 0, x, y, z, facing, done: false } as Spark);
    }
    for (const [name, vol] of s.snd) playSound(name, vol);
    if (s.mu && s.mu !== F.musicKey) { F.musicKey = s.mu; playMusic(s.mu); }
  }

  /** Per rendered step: interpolate positions, run the sparks' animations, tick the banner. */
  step(dt: number): void {
    const F = this.fight;
    for (const [u, f] of this.byUid) {
      const l = this.lerp.get(u);
      if (!l || l.t >= 1) continue;
      l.t = Math.min(1, l.t + dt / SNAP_INTERVAL);
      f.pos = { x: l.fx + (l.tx - l.fx) * l.t, y: l.fy + (l.ty - l.fy) * l.t, z: l.fz + (l.tz - l.fz) * l.t };
    }
    for (const s of F.sparks) {
      s.t += dt;
      while (!s.done && s.t >= s.anim.frames[s.frame]!.t / 60) {
        s.t -= s.anim.frames[s.frame]!.t / 60;
        s.frame++;
        if (s.frame >= s.anim.frames.length) { s.done = true; s.frame = s.anim.frames.length - 1; }
      }
    }
    F.sparks = F.sparks.filter((s) => !s.done);
    // between two snapshots: things in flight keep flying, the power-up clocks keep running
    for (const p of F.projectiles) { p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.t += dt; }
    for (const it of F.items) it.t -= dt;
    for (const f of this.byUid.values()) {
      const b = f.buff;
      b.speed = Math.max(0, b.speed - dt); b.shield = Math.max(0, b.shield - dt); b.power = Math.max(0, b.power - dt); b.fang = Math.max(0, b.fang - dt);
      f.stars = Math.max(0, f.stars - dt);
    }
    F.time += dt;
  }

  /** seconds since the last snapshot (to notice a dead connection) */
  get silence(): number { return this.lastAt ? (performance.now() - this.lastAt) / 1000 : 0; }

  dispose(): void { this.byUid.clear(); this.lerp.clear(); }
}

