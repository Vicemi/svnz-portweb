// Fight (svnz.exe Fight/FightersManager/CollisionsManager/WavesManager): fighters, hit detection, sparks,
// slow motion, shakes and the wave flow of each game mode.
import { Fighter, CHARS, FSM, type Spark, type Clone } from './fighter';
import { DB, makeDesc, type FighterSpec, type LevelDef, type WaveDef } from './data';
import { AIPad, RemoteSource, UserPad, keyboard } from './pad';
import { AIController } from './ai';
import { playMusic, playSound } from '../core/audio';
import { rosterOf } from '../online/roster';
import { paletteOf } from '../online/variants';
import { ITEMS, NO_POWERUPS, type FightSettings, type ItemKey } from '../online/items';
import { SOLO, type Difficulty } from '../online/scaling';

export interface Area { x0: number; z0: number; w: number; d: number }

/** FightingArea dojo/arena/practice (0041dd90): x 0..480, z 60..220; dungeon (0041de10) differs only in art. */
export const AREA: Area = { x0: 0, z0: 60, w: 480, d: 160 };

export interface Projectile { x: number; y: number; z: number; vx: number; vy: number; vz: number; hit: string; owner: Fighter; anim: number; t: number; char?: string }
/** Power-up lying on the map: the ninja star (bonus level) or any of the online power-ups (type). */
export interface Item { x: number; z: number; t: number; type: ItemKey }

export type Phase = 'intro' | 'ready' | 'fight' | 'cleared' | 'failed' | 'done';

/** One human of a VS / co-op match (local keyboard, second keyboard layout, or a remote player on the network). */
export interface PlayerSlot { id: number; nick: string; char: string; team: number; control: 'p1' | 'p2' | 'remote'; /** colour variant picked in the lobby */ variant?: number }
export interface FightOptions {
  mode: 'coop' | 'vs';
  players: PlayerSlot[];
  difficulty: Difficulty;
  /** slot of the player whose screen this is */
  localId: number;
  /** power-ups and VS lives (online only; leave it out for none) */
  settings?: FightSettings;
}
export type FightMode = 'story' | 'coop' | 'vs';

export { VS_LEVEL } from '../online/const';

/** Co-op caps: enemies on screen at once (waves) / extra fighters next to a boss. */
const MAX_ON_SCREEN = 10;
const MAX_EXTRAS = 8;

const scaleList = <T>(list: T[], factor: number): T[] => {
  const n = Math.max(list.length ? 1 : 0, Math.round(list.length * factor));
  return Array.from({ length: n }, (_, i) => list[i % list.length]!);
};

export class Fight {
  fighters: Fighter[] = [];
  sparks: Spark[] = [];
  projectiles: Projectile[] = [];
  items: Item[] = [];
  private itemTimer = 14 + Math.random() * 10;
  private heartTimer = 10;
  private lastItem: ItemKey | null = null;
  settings: FightSettings = NO_POWERUPS;
  /** online: round trip of this player's connection (ms) and whether it is a direct link (P2P) or through the server */
  netInfo: { ping: number; p2p: boolean } | null = null;
  /** VS: lives each player starts with (0 = no lives, the original rules) */
  maxStocks = 0;
  clones: (Clone & { char: string })[] = [];
  area = AREA;
  time = 0;
  slow = { rate: 1, t: 0 };
  shake = { amp: 0, t: 0 };
  protag: { f: Fighter; t: number } | null = null;
  players: Fighter[] = [];
  /** the humans (the ones with combos and a life bar): only the first one of the original modes, every player of the VS / co-op modes */
  humans: Fighter[] = [];
  mode: FightMode = 'story';
  difficulty: Difficulty = SOLO;
  /** the fighter this screen belongs to */
  local!: Fighter;
  /** VS: who won (team number, 0 = draw) once the match is over */
  result: { winner: number } | null = null;
  /** sparks created since the last network snapshot (host) */
  sparkLog: { char: string; id: number; x: number; y: number; z: number; facing: number }[] = [];
  /** guest: this Fight only mirrors the host's snapshots, nothing is simulated here */
  mirror = false;
  activeEnemies = 1;
  activeExtras = 0;
  musicKey = '';

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
   *  2.2 s at 20 hits (DAT_004f1218); the bar shows remaining/window. Kept per human (Fighter.combo); these are the local player's. */
  get combo() { return this.local.combo; }
  /** Enemy shown in the bottom-right life bar: the last one the human hit (Fight +0x3d0). */
  get target(): Fighter | null { return this.local.comboTarget; }
  timeLeft = 0;
  spawnTimer = 0;
  finished = false;
  won = false;

  constructor(readonly levelKey: string, readonly opts?: FightOptions, mirror = false) {
    this.level = DB.levels[levelKey];
    this.mirror = mirror;
    if (opts) {
      this.mode = opts.mode;
      this.difficulty = opts.difficulty;
      this.settings = opts.settings ?? NO_POWERUPS;
      if (opts.mode === 'vs') this.maxStocks = this.settings.lives;
    }
    if (mirror) return;
    if (opts) this.buildPlayers(opts);
    else {
      const team = DB.lists[this.level.playerTeam];
      team.fighters.forEach((spec, i) => {
        const desc = makeDesc(spec);
        const human = i === 0;
        const f = new Fighter(desc, this, { cpu: !human, team: team.team, color: desc.color, life: human ? undefined : parseInt(spec.attrs.lifeCPU ?? '', 10) || desc.lifeCPU });
        f.usesPower = human;          // only the human gets a power meter (004205c0), starting at 250
        f.power = human ? 250 : 0;
        if (human) f.pad = new UserPad();
        else { const p = new AIPad(); f.pad = p; f.ai = new AIController(f, p, desc.decisionsAI, desc.reflexesAI); f.evil = false; }
        this.place(f, spec.yPos);
        f.changeState(spec.state ?? desc.state);
        this.fighters.push(f);
        this.players.push(f);
      });
      this.humans = [this.players[0]!];
      this.local = this.players[0]!;
    }
    this.startWave(0);
  }

  /** VS / co-op: one human fighter per slot, each with the character it picked. */
  private buildPlayers(o: FightOptions): void {
    const used = new Map<string, number>();
    const byTeam = new Map<number, number>();
    o.players.forEach((slot) => {
      const r = rosterOf(slot.char);
      const desc = makeDesc({ type: r.key, nameIndex: 0, state: r.state, yPos: r.yPos, attrs: { lifeHuman: String(r.life) } });
      const n = used.get(r.key) ?? 0;
      used.set(r.key, n + 1);
      const pal = Math.max(1, desc.numberOfPalettes);
      // the colour picked in the lobby; without one, two players with the same character still get different colors
      desc.color = slot.variant !== undefined ? paletteOf(r.key, slot.variant) : (Math.max(0, desc.color) + n) % pal;
      const f = new Fighter(desc, this, { cpu: false, team: slot.team, color: desc.color, life: r.life });
      f.usesPower = true;
      f.power = 250;
      f.dmgMul = o.mode === 'vs' ? r.dmg ?? 1 : 1;
      if (r.noArmor && o.mode === 'vs') f.armorMode = false;
      f.stocks = this.maxStocks;
      f.slot = slot.id;
      f.nick = slot.nick;
      f.name = slot.nick;
      if (slot.control === 'remote') { f.remote = new RemoteSource(); f.pad = new UserPad(f.remote); }
      else f.pad = new UserPad(keyboard(slot.control));
      const k = byTeam.get(slot.team) ?? 0;
      byTeam.set(slot.team, k + 1);
      this.placeSlot(f, o.mode, slot.team, k, r.yPos);
      f.changeState(r.state ?? desc.state);
      this.fighters.push(f);
      this.players.push(f);
      if (slot.id === o.localId) this.local = f;
    });
    this.humans = this.players.slice();
    this.local ??= this.players[0]!;
  }

  /** Starting spots: VS teams face each other from the two sides; co-op players start together on the left. */
  private placeSlot(f: Fighter, mode: string, team: number, k: number, y?: number): void {
    const ar = this.area;
    const z = ar.z0 + 20 + ((k * 47 + (team === 2 ? 23 : 0)) % (ar.d - 40));
    let x: number;
    if (mode === 'vs') { x = team === 1 ? 50 + (k % 2) * 28 : ar.w - 50 - (k % 2) * 28; f.facing = team === 1 ? 1 : -1; }
    else { x = 60 + (k % 2) * 30; f.facing = 1; }
    f.pos = { x, y: y ?? 0, z };
  }

  // ------------------------------------------------------------------ waves
  startWave(i: number): void {
    this.waveIdx = i;
    const lw = this.level.waves[i];
    this.wave = DB.waves[lw.name];
    const w = this.wave;
    const d = this.difficulty;
    // co-op: the more players, the more enemies (on screen and per wave); bosses and their extras scale too
    this.queue = DB.lists[w.list]?.fighters ?? [];
    if (this.mode === 'coop' && w.mode !== 'BossMode' && w.mode !== 'SurvivalMode' && w.mode !== 'TimeMode') this.queue = scaleList(this.queue, d.count);
    // on screen at once the original number scaled up, but never more than the arena can hold
    this.activeEnemies = this.mode === 'coop' ? Math.max(w.activeEnemies, Math.min(MAX_ON_SCREEN, Math.ceil(w.activeEnemies * d.count - 1e-9))) : w.activeEnemies;
    this.activeExtras = this.mode === 'coop' ? Math.max(w.activeExtras, Math.min(MAX_EXTRAS, Math.ceil(w.activeExtras * d.count - 1e-9))) : w.activeExtras;
    this.queuePos = 0;
    this.extrasQueue = w.listExtras ? DB.lists[w.listExtras]?.fighters ?? [] : [];
    this.extrasPos = 0;
    this.boss = null;
    if (this.mode === 'coop' && i > 0) this.reviveAndHeal();
    this.timeLeft = this.wave.time;
    this.phase = 'intro';
    this.phaseT = 0;
    this.banner = lw.initialTextKey;
    this.bannerT = 2;
    const music = lw.music ?? this.level.music;
    if (music && music !== 'NONE') { playMusic(music); this.musicKey = music; }
  }

  /** A fallen player stands up again where it is standing now (life = a share of the maximum), blinking and untouchable for a moment. */
  revivePlayer(p: Fighter, lifeShare: number): void {
    const st = p.stateOf('Stand');
    p.dead = false;
    p.hidden = false;
    p.life = Math.max(1, Math.ceil(p.lifeMax * lifeShare));
    p.power = Math.max(p.power, 100);
    p.vel = { x: 0, y: 0, z: 0 };
    p.pending = null;
    p.buff = { speed: 0, shield: 0, power: 0, fang: 0 };
    p.stars = 0;
    if (st) p.enter('Stand', st);
    p.invTimed = true;
    p.invTime = 2.5;
    p.blink = true;
    this.addSpark(0, p.pos.x, 10, p.pos.z + 1, 1);
  }

  /** VS: a player who lost a life comes back at a random spot with full life. */
  private respawnPlayer(p: Fighter): void {
    this.place(p, p.desc.key === 'Bat' ? 30 : 0);
    this.revivePlayer(p, 1);
  }

  /** Between waves of a co-op match: fallen players come back with half their life, the others recover a quarter. */
  private reviveAndHeal(): void {
    for (const p of this.players) {
      if (p.dead) {
        this.placeSlot(p, 'coop', p.team, Math.max(0, p.slot), p.desc.key === 'Bat' ? 30 : 0);
        this.revivePlayer(p, 0.5);
      } else if (p.life > 0) {
        p.life = Math.min(p.lifeMax, p.life + Math.ceil(p.lifeMax * 0.25));
      }
    }
  }

  private enemies(): Fighter[] { return this.fighters.filter((f) => !this.players.includes(f) && !f.dead); }

  private spawn(spec: FighterSpec, team: number, asBoss: boolean): Fighter {
    const desc = makeDesc(spec);
    const base = parseInt(spec.attrs.lifeCPU ?? '', 10) || desc.lifeCPU;
    const life = this.mode === 'coop' ? Math.round(base * (asBoss ? this.difficulty.boss : this.difficulty.hp)) : base;
    const f = new Fighter(desc, this, { cpu: true, team, color: desc.color, life });
    const p = new AIPad();
    f.pad = p;
    f.ai = new AIController(f, p, desc.decisionsAI, desc.reflexesAI);
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
      if (w.mode === 'VsMode') {
        const left = new Set(this.players.filter((p) => p.alive).map((p) => p.team));
        if (left.size <= 1) {
          const winner = left.size ? [...left][0]! : 0;
          this.result = { winner };
          this.clear();
          const w = this.players.find((p) => p.team === winner);
          this.banner = w ? `${(w.nick || w.name).replace(/[^\x21-\x7e ]/g, '').trim() || 'PLAYER'} WINS!` : 'DRAW!';
        }
      } else if (w.mode === 'BossMode') {
        if (!this.boss && this.queuePos < this.queue.length) this.boss = this.spawn(this.queue[this.queuePos++], team, true);
        const extras = alive.filter((f) => f !== this.boss);
        // a boss that is dying (life 0, death animation still playing) already ends the wave: no more extras fall in
        if (this.boss && !this.boss.dead && this.boss.life > 0 && extras.length < this.activeExtras && this.extrasQueue.length) {
          this.spawnTimer -= dt;
          if (this.spawnTimer <= 0) {
            this.spawn(this.extrasQueue[this.extrasPos % this.extrasQueue.length], team, false);
            this.extrasPos++;
            this.spawnTimer = 1;
          }
        }
        if (this.boss && (this.boss.dead || this.boss.life <= 0)) this.clear();
      } else {
        const loops = w.mode === 'TimeMode' || w.mode === 'SurvivalMode';
        if (w.mode === 'TimeMode') this.timeLeft = Math.max(0, this.timeLeft - dt);
        if (!(w.mode === 'TimeMode' && this.timeLeft <= 0) && alive.length < this.activeEnemies && (loops || this.queuePos < this.queue.length)) {
          this.spawnTimer -= dt;
          if (this.spawnTimer <= 0) {
            if (this.queuePos >= this.queue.length) this.queuePos = Math.min(w.loopIndex, this.queue.length - 1);
            this.spawn(this.queue[this.queuePos++], team, false);
            this.spawnTimer = 0.6;
          }
        }
        if (!loops && this.queuePos >= this.queue.length && alive.length === 0) this.clear();
        if (w.mode === 'TimeMode' && this.timeLeft <= 0) this.clear();
      }
      if (this.mode === 'story') {
        if (this.players.some((p) => p.dead || p.life === 0 && p.stateName === 'Dead')) {
          if (this.players.some((p) => p.dead)) this.fail();
        }
      } else if (this.mode === 'coop' && this.phase === 'fight' && this.players.every((p) => p.dead)) this.fail();
    } else if (this.phase === 'cleared' && this.phaseT > 3) {
      if (this.waveIdx + 1 < this.level.waves.length) this.startWave(this.waveIdx + 1);
      else { this.phase = 'done'; this.finished = true; this.won = this.mode === 'vs' ? !!this.result && this.result.winner === this.local.team : true; }
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
  // --- IFight queries used by the AI (Fight vtable +0x64..+0xb0, 0041dfb0..0041f3f0)
  enemiesOf(f: Fighter): Fighter[] { return this.fighters.filter((o) => o !== f && !o.dead && o.team !== f.team); }
  /** Fight::v29: a random enemy (rand % n). */
  randomEnemy(f: Fighter): Fighter | null {
    const e = this.enemiesOf(f);
    return e.length ? e[Math.floor(Math.random() * e.length) % e.length] : null;
  }
  /** Fight::v35: the closest enemy by 3D distance. */
  closestEnemy(f: Fighter): Fighter | null {
    let best: Fighter | null = null, bd = Infinity;
    for (const o of this.enemiesOf(f)) {
      const d = Math.hypot(o.pos.x - f.pos.x, o.pos.y - f.pos.y, o.pos.z - f.pos.z);
      if (d <= bd) { bd = d; best = o; }
    }
    return best;
  }
  /** Fight::v36 / v37: strongest / weakest by `strength` (all 1 here, so the first enemy of the list). */
  strongEnemy(f: Fighter): Fighter | null {
    let best: Fighter | null = null, bs = -1;
    for (const o of this.enemiesOf(f)) if (bs < o.desc.strength) { bs = o.desc.strength; best = o; }
    return best;
  }
  weakEnemy(f: Fighter): Fighter | null {
    let best: Fighter | null = null, bs = 99999;
    for (const o of this.enemiesOf(f)) if (o.desc.strength < bs) { bs = o.desc.strength; best = o; }
    return best;
  }
  /** Fight::v30 (0041e2a0): random point of the area keeping 1.2 x collisionWidth from the walls. */
  randomPos(f: Fighter): { x: number; z: number } {
    const ar = this.area;
    const m = f.desc.collisionWidth * 1.2;
    return { x: ar.x0 + m + Math.random() * (ar.w - 2 * m), z: ar.z0 + Math.random() * ar.d };
  }
  /** Fight::v16 / v17: keep a goal inside the fighting area (x by the fighter radius). */
  clampPos(x: number, z: number, radius: number): { x: number; z: number } {
    const ar = this.area;
    return { x: Math.max(ar.x0 + radius, Math.min(ar.x0 + ar.w - radius, x)), z: Math.max(ar.z0, Math.min(ar.z0 + ar.d, z)) };
  }

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
    if (this.mode === 'vs' && this.players.includes(f)) {
      if (f.stocks > 1) { f.stocks--; f.life = f.lifeMax; f.respawn = 1.8; }   // a life lost: back soon (life refilled so it still counts as alive)
      else { f.stocks = 0; f.out = true; }
    }
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

  addSpark(id: number, x: number, y: number, z: number, facing: number, char = 'Effects'): void {
    const a = CHARS[char].anims[String(id)];
    if (!a) return;
    if (this.sparkLog.length < 64) this.sparkLog.push({ char, id, x, y, z, facing });
    this.sparks.push({ char, anim: a, id, frame: 0, t: 0, x, y, z, facing, done: false });
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
      if (f.ai && this.phase === 'fight' && f.life > 0) f.ai.update(fdt);
      f.update(fdt);
      f.remote?.endTick();
    }
    this.collide();
    this.updateProjectiles(fdt);
    this.updateItems(fdt);
    for (const s of this.sparks) {
      s.t += fdt;
      while (!s.done && s.t >= s.anim.frames[s.frame].t / 60) {
        s.t -= s.anim.frames[s.frame].t / 60;
        s.frame++;
        if (s.frame >= s.anim.frames.length) { s.done = true; s.frame = s.anim.frames.length - 1; }
      }
    }
    this.sparks = this.sparks.filter((s) => !s.done);
    for (const h of this.humans) {
      if (h.dead && !h.out && h.respawn > 0) {
        h.respawn -= dt;
        if (h.respawn <= 0) this.respawnPlayer(h);
      }
      if (h.combo.hits > 0) {
        h.combo.left -= fdt;
        if (h.combo.left <= 0) h.combo = { hits: 0, window: 0, left: 0 };
      }
      if (h.comboTarget && h.comboTarget.dead) h.comboTarget = null;
    }
    for (const c of this.clones) c.life -= fdt;
    this.clones = this.clones.filter((c) => c.life > 0);
    this.fighters = this.fighters.filter((f) => !f.dead || this.players.includes(f));
  }

  // ------------------------------------------------------------------ projectiles (bonus characters)
  /** One shot from `o`: starts `ox` in front and `oy` above its feet, `speed` px/s along its facing; with `aim` it also
   *  drifts in depth (z) so it reaches the target's plane. */
  shoot(o: Fighter, hit: string, anim: number, ox: number, oy: number, speed: number, aim: boolean, dy = 0): Projectile {
    const dir = o.facing;
    [ox, oy] = this.muzzle(o, ox, oy);
    const p: Projectile = { x: o.pos.x + dir * ox, y: o.pos.y + oy, z: o.pos.z, vx: dir * speed, vy: dy, vz: 0, hit, owner: o, anim, t: 0 };
    const t = o.target;
    if (aim && t && !t.dead) {
      const T = Math.max(0.2, Math.abs(t.pos.x - p.x) / speed);
      p.vz = Math.max(-140, Math.min(140, (t.pos.z - p.z) / T));
    }
    this.projectiles.push(p);
    return p;
  }
  /** Mina's ninja star: leaves her hand (frame muzzle), flies along her facing and leans toward the nearest enemy in front. */
  throwStar(o: Fighter, hit: string): void {
    const front = this.enemiesOf(o).filter((e) => !e.dead && (e.pos.x - o.pos.x) * o.facing > 0);
    const t = front.sort((a, b) => Math.abs(a.pos.x - o.pos.x) - Math.abs(b.pos.x - o.pos.x))[0];
    const prev = o.target;
    o.target = t ?? null;
    const p = this.shoot(o, hit, 1, 22, 26, 380, !!t);
    o.target = prev;
    p.char = 'NinjaStar';
  }
  // ------------------------------------------------------------------ power-ups
  private updateItems(dt: number): void {
    if (this.phase !== 'fight') return;
    const legacy = this.levelKey === 'bonusXaLevel';               // the original bonus mode: one ninja star for the first player
    const online = this.mode !== 'story' && this.settings.powerups && this.settings.items.length > 0;
    if (!legacy && !online) return;
    const users = (legacy ? this.players.slice(0, 1) : this.players).filter((p) => !p.dead);
    for (const it of this.items) it.t -= dt;
    this.items = this.items.filter((it) => it.t > 0);
    for (const it of this.items) {
      for (const p of users) {
        if (Math.abs(it.x - p.pos.x) < 24 + p.radius && Math.abs(it.z - p.pos.z) < 20) {
          this.collect(p, it);
          it.t = 0;
          break;
        }
      }
    }
    this.items = this.items.filter((it) => it.t > 0);
    if (legacy) {
      const p = users[0];
      if (p && this.items.length === 0 && p.stars <= 0) {
        this.itemTimer -= dt;
        if (this.itemTimer <= 0) {
          const q = this.randomPos(p);
          this.items.push({ x: q.x, z: q.z, t: 14, type: 'star' });
          this.itemTimer = 10;
        }
      }
      return;
    }
    // Rhythm: power-ups are rare, like in Smash. One lies on the map at a time and the next one comes 20 to 36 s after the previous one
    // appeared (the first one after 14 to 24 s), so nobody has advantages all the time. The heart of the co-op has its own, shorter clock
    // and only runs while somebody is down.
    const down = this.mode === 'coop' && this.settings.items.includes('heart') && this.players.some((p) => p.dead && !p.out);
    const heartOnMap = this.items.some((i) => i.type === 'heart');
    if (down && !heartOnMap) {
      this.heartTimer -= dt;
      if (this.heartTimer <= 0) {
        const q = this.randomPos(users[0] ?? this.players[0]!);
        this.items.push({ x: q.x, z: q.z, t: 18, type: 'heart' });
        this.heartTimer = 12 + Math.random() * 10;
      }
    } else if (!down) this.heartTimer = 8 + Math.random() * 6;
    this.itemTimer -= dt;
    if (this.itemTimer > 0 || this.items.some((i) => i.type !== 'heart')) return;
    const type = this.pickItem();
    this.itemTimer = 20 + Math.random() * 16;
    if (!type) return;
    const q = this.randomPos(users[0] ?? this.players[0]!);
    this.items.push({ x: q.x, z: q.z, t: 14, type });
    this.lastItem = type;
  }

  /** Which power-up appears next: any enabled one except the heart (it has its own clock) and the one that came last. */
  private pickItem(): ItemKey | null {
    const pool = this.settings.items.filter((k) => k !== 'heart' && k !== this.lastItem);
    const from = pool.length ? pool : this.settings.items.filter((k) => k !== 'heart');
    if (from.length === 0) return null;
    return from[Math.floor(Math.random() * from.length)]!;
  }

  private collect(p: Fighter, it: Item): void {
    playSound('special');
    this.addSpark(0, it.x, 10, it.z + 1, 1);
    switch (it.type) {
      case 'star': p.stars = 20; break;
      case 'bolt': p.buff.speed = 12; break;
      case 'shield': p.buff.shield = 10; break;
      case 'fist': p.buff.power = 12; break;
      case 'fang': p.buff.fang = 12; break;
      case 'heart': {
        const fallen = this.players.filter((q) => q.dead && !q.out);
        const q = fallen[Math.floor(Math.random() * fallen.length)];
        if (q) {
          q.pos = { x: Math.max(20, Math.min(460, p.pos.x + (Math.random() < 0.5 ? -26 : 26))), y: q.desc.key === 'Bat' ? 30 : 0, z: p.pos.z };
          this.revivePlayer(q, 0.5);
        } else p.life = Math.min(p.lifeMax, p.life + Math.ceil(p.lifeMax * 0.25));
        break;
      }
    }
  }

  /** XA boss fan (EnemyBoss BOSS_BULLETS): 5 shots from 60 to 120 degrees, up to down, all leaning toward the target's depth. */
  shootFan(o: Fighter, hit: string, anim: number, ox: number, oy: number, speed: number, n: number): void {
    const dir = o.facing;
    const t = o.target;
    [ox, oy] = this.muzzle(o, ox, oy);
    for (let k = 0; k < n; k++) {
      const ang = Math.PI / 3 + k * (Math.PI / 12);
      const p: Projectile = { x: o.pos.x + dir * ox, y: o.pos.y + oy, z: o.pos.z, vx: dir * Math.sin(ang) * speed, vy: Math.cos(ang) * speed, vz: 0, hit, owner: o, anim, t: 0 };
      if (t && !t.dead) {
        const T = Math.max(0.3, Math.abs(t.pos.x - p.x) / Math.max(40, Math.abs(p.vx)));
        p.vz = Math.max(-120, Math.min(120, (t.pos.z - p.z) / T));
      }
      this.projectiles.push(p);
    }
  }
  /** Where the shot leaves: the weapon's muzzle of the picture on screen (frame.mz), else the offsets given. */
  private muzzle(o: Fighter, ox: number, oy: number): [number, number] {
    const mz = o.frame?.mz;
    return mz ? [mz[0], -mz[1]] : [ox, oy];
  }
  private updateProjectiles(dt: number): void {
    const ar = this.area;
    for (const p of this.projectiles) {
      p.t += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      let done = p.t > 5 || p.x < ar.x0 - 40 || p.x > ar.x0 + ar.w + 40 || p.y < 0 || p.z < ar.z0 - 10 || p.z > ar.z0 + ar.d + 10;
      if (done && p.y < 0) { this.addSpark(10, p.x, 0, p.z, 1, 'XaFx'); }
      if (!done) {
        const sx = Math.floor(p.x + 0.5), sy = Math.floor(p.z * 0.5 - p.y + 0.5);
        for (const v of this.enemiesOf(p.owner)) {
          if (!v.canBeHit() || Math.abs(v.pos.z - p.z) >= 24) continue;
          const hit = v.rects('body').some((r) => sx + 7 > r[0] && sx - 7 < r[0] + r[2] && sy + 7 > r[1] && sy - 7 < r[1] + r[3]);
          if (!hit) continue;
          const def = FSM.hits[p.hit];
          if (def) {
            const att = { facing: p.vx >= 0 ? 1 : -1, pos: { x: p.x, y: p.y, z: p.z }, team: p.owner.team, uid: -1, damageMul: p.owner.damageMul, onDealt: (d: number) => p.owner.onDealt(d) } as unknown as Fighter;
            if (!v.receiveHit(def, att)) {
              if (p.char) this.addSpark(def.spark, p.x, p.y, p.z + 1, att.facing);
              else { this.addSpark(10, p.x, p.y, p.z, 1, 'XaFx'); playSound('xa_wall'); }
              if (this.humans.includes(p.owner)) this.comboHit(p.owner, v);
            }
          }
          done = true;
          break;
        }
      }
      if (done) p.t = 99;
    }
    this.projectiles = this.projectiles.filter((p) => p.t < 90);
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
    const blocked = vic.receiveHit(h, att);
    att.hitConnect(h, r, vic);
    if (this.humans.includes(att) && vic.team !== att.team && !blocked) this.comboHit(att, vic);
  }
  private comboHit(att: Fighter, vic: Fighter): void {
    att.comboTarget = vic;
    const c = att.combo;
    c.hits++;
    c.window = c.hits === 1 ? 1 : 1 + 1.2 * Math.min(1, c.hits / 20);
    c.left = c.window;
  }
  /** Does `a`'s current hit reach `b`? Returns the intersection rect. */
  private check(a: Fighter, b: Fighter): [number, number, number, number] | null {
    if (!a.isAttacking() || a.pause > 0) return null;
    if (a.hitVictims.has(b.uid) || !b.canBeHit()) return null;
    const h = a.hit!;
    switch (h.target) {
      case 31: if (a.team === b.team) return null; break;
      case 32: if (a.team !== b.team) return null; break;
      // 33 = hurts everybody (Big Demon's punch and body slam). Between the players of a co-op team it must not: no friendly fire
      case 33: if (this.mode === 'coop' && a.team === b.team && this.humans.includes(a) && this.humans.includes(b)) return null; break;
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

  /** A player left the match (closed the tab): their fighter is gone. */
  removePlayer(slot: number): void {
    const p = this.players.find((q) => q.slot === slot);
    if (!p || p.dead) return;
    p.life = 0;
    p.dead = true;
    p.hidden = true;
    p.remote?.release();
  }
}

export { playSound };
