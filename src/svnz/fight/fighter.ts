// Fighter: port of svnz.exe's Fighter (state machine, physics, animation, hits). Offsets in comments are the
// original object's fields (Fighter base; the IConditionFighter/IActionFighter interface sits at +0x150).
import fsmJson from '../data/fsm.json';
import charsJson from '../data/chars.json';
import type { Act, Anim, CharDesc, CharSprites, Cond, ControlTrig, FState, FsmData, HitDef, Params, Rect, Trig } from './types';
import type { Fight } from './fight';
import type { Pad } from './pad';
import { playSound } from '../core/audio';

export const FSM = fsmJson as unknown as FsmData;
export const CHARS = charsJson as unknown as Record<string, CharSprites>;

const TICK = 1 / 60; // DAT_004f6b40: ticks -> seconds
const ANIM_FPS = 60;
const Z_HIT_RANGE = 24; // DAT_004f11fc

export interface Vec3 { x: number; y: number; z: number }

class AnimPlayer {
  anim: Anim | null = null;
  id = -1;
  frame = 0;
  prev = -1;
  t = 0;
  dur = 0;
  playing = false;
  ended = false;          // +0x15d
  active = false;         // +0x168 first frame with red rects reached (one update)
  activeArmed = true;     // +0x169
  passive = false;        // +0x16a
  passiveArmed = true;    // +0x16b

  set(anim: Anim, id: number): void {
    this.anim = anim;
    this.id = id;
    this.t = 0;
    this.ended = false;
    this.frame = 0;
    this.active = false;
    this.passive = false;
    this.playing = true;
    this.prev = -1;
    this.activeArmed = true;
    this.passiveArmed = true;
    this.dur = anim.frames[0].t / ANIM_FPS;
  }

  /** AnimationPlayer::update (004295c0 + 00429680). */
  update(dt: number): void {
    this.active = false;
    const a = this.anim;
    if (!a) return;
    this.prev = this.frame;
    if (this.playing) {
      this.t += dt;
      while (this.t >= this.dur) {
        this.frame++;
        if (this.frame === a.frames.length) {
          if (a.loop === -1) {
            this.frame = a.frames.length - 1;
            this.t = this.dur;
            this.playing = false;
            this.ended = true;
            break;
          }
          this.t -= this.dur;
          this.frame = a.loop;
        } else {
          this.t -= this.dur;
        }
        this.dur = a.frames[this.frame].t / ANIM_FPS;
        if (this.dur <= 0) break;
      }
    }
    const f = a.frames[this.frame];
    if (this.activeArmed && f.hit.length > 0) { this.active = true; this.activeArmed = false; }
    if (this.passiveArmed && f.body.length > 0) { this.passive = true; this.passiveArmed = false; }
  }
}

export interface Spark { anim: Anim; id: number; frame: number; t: number; x: number; y: number; z: number; facing: number; done: boolean }
export interface Clone { img: string; sheet: number; x: number; y: number; z: number; facing: number; ox: number; oy: number; flip: string; life: number; max: number; color: [number, number, number, number] }

let nextId = 1;

export class Fighter {
  readonly uid = nextId++;
  readonly sprites: CharSprites;
  pos: Vec3 = { x: 0, y: 0, z: 0 };   // +0x1e8
  vel: Vec3 = { x: 0, y: 0, z: 0 };   // +0x1f4
  gForce = 0;                          // +0x204 constant y force (gravity while in the air)
  friction = 0;                        // +0x220
  maxSpeed = 100000;                   // +0x21c
  physMode = 2;                        // +0x50c 0 ground 1 air
  facing = 1;                          // +0x1a4
  hasFallen = false;                   // +0x510

  life = 100;
  lifeMax = 100;
  power = 0;                           // 0..300
  usesPower = false;
  dead = false;                        // removed from the fight
  visible = true;

  // state machine
  stateName = '';                      // generic name (StateEquals compares this)
  prevStateName = '';
  state: FState | null = null;         // +0x23c
  pending: { name: string; st: FState } | null = null; // +0x25c
  memo = '';                           // +0x29c
  memoGo = false;                      // +0x298
  triggers: (Trig | null)[] = [];      // +0x534
  ctrl = [true, true, true];           // +0x304..306 (types 0/3, 1, 2)
  stateTime = 0;                       // +0x520
  prevStateTime = 0;                   // +0x524
  starting = false;                    // +0x238
  walking = false;                     // +0x1e0
  freeze = false;                      // +0x2f4
  armor = false;                       // +0x2f5 (state)
  armorMode = false;                   // characters.xml armorMode
  invincible = false;                  // +0x2f7 (state)
  invTimed = false;                    // +0x2f8
  invTime = 0;                         // +0x2fc
  blink = false;                       // +0x224
  blinkOn = true;
  afterImages: { on: boolean; t: number; every: number; life: number; color: [number, number, number, number] } = { on: false, t: 0, every: 0, life: 0, color: [1, 1, 1, 1] };
  special: { on: boolean; state: string; pause: number; spark: number; flag: boolean } = { on: false, state: '', pause: 0, spark: -1, flag: false };

  // timers (+0x22c pause / hitstop, +0x230 affect, +0x234 displacement)
  pause = 0;
  affect = 0;
  displace = 0;
  shake = { on: false, amp: 0, t: 0, max: 0 };

  // hits
  hit: HitDef | null = null;           // performed hit definition (+0x194)
  hitName = '';
  hitVictims = new Set<number>();
  hitContactNow = false;               // +0x2ed
  hitConnected = false;                // +0x2ee
  prevHitConnected = false;            // +0x2ef
  hitResult = 0;                       // +0x4ec
  prevHitResult = 0;                   // +0x4f0
  recv: HitDef | null = null;          // +0x2e8 received
  recvAttackerX = 0;                   // +0x2f0
  frontHit = false;                    // +0x2e0
  recvGround: Vec3 = { x: 0, y: 0, z: 0 };
  recvAir: Vec3 = { x: 0, y: 0, z: 0 };
  recvDamage = 0;

  anim = new AnimPlayer();
  pad: Pad | null = null;
  controls: ControlTrig[] = [];
  dict: Record<string, string> = {};
  team = 0;
  cpu = false;
  boss = false;
  evil = false;
  extra = false;
  name: string;
  sheet = 0;
  ai: { update(dt: number): void } | null = null;
  /** IAIFighter target (Fighter +0x31c): who the AI is aiming at; null = none (-1). */
  target: Fighter | null = null;
  lastAttacker: Fighter | null = null;

  constructor(readonly desc: CharDesc, readonly fight: Fight, opts: { cpu: boolean; team: number; color: number; life?: number }) {
    this.sprites = CHARS[desc.dataKey];
    this.name = desc.alias;
    this.cpu = opts.cpu;
    this.team = opts.team;
    this.sheet = Math.max(0, Math.min(this.sprites.sheets.length - 1, opts.color));
    this.lifeMax = this.life = opts.life ?? (opts.cpu ? desc.lifeCPU : desc.lifeHuman);
    this.armorMode = desc.armorMode;
    const dict = FSM.dicts[desc.statesDictionary];
    this.dict = dict ? dict.map : {};
    this.controls = FSM.controls[opts.cpu ? desc.controlTriggersCPU : desc.controlTriggersHuman] ?? [];
  }

  // ---------------------------------------------------------------- queries
  stateOf(generic: string): FState | null {
    const spec = this.dict[generic];
    return spec ? FSM.states[spec] ?? null : null;
  }
  get frame() { const a = this.anim.anim; return a ? a.frames[this.anim.frame] : null; }
  isAttacking(): boolean { return !!this.hit && !!this.frame && this.frame.hit.length > 0; }
  stickX(): number { return this.pad ? this.pad.x : 0; }
  stickY(): number { return this.pad ? this.pad.y : 0; }

  // ---------------------------------------------------------------- state changes
  /** FUN_0040bcb0: request a state by generic name (applied at the end of the update). */
  changeState(name: string): void {
    const st = this.stateOf(name);
    if (!st) return;
    if (!this.pending) {
      this.pending = { name, st };
      return;
    }
    const c = controlFlags(this.pending.st.control);
    const ok = st.type === 1 ? c[1] : st.type === 2 ? c[2] : st.type === 0 || st.type === 3 ? c[0] : false;
    if (ok) this.pending = { name, st };
  }
  /** FUN_0040bdb0: forced change (damage, death). */
  forceState(name: string): void {
    const st = this.stateOf(name);
    if (!st) return;
    this.pending = { name, st };
  }

  /** FUN_0040ba90: enter the pending state. */
  enter(name: string, st: FState): void {
    this.starting = true;
    this.prevStateName = this.stateName;
    this.stateName = name;
    this.prevHitConnected = this.hitConnected;
    this.prevHitResult = this.hitResult;
    this.memoGo = false;
    this.walking = false;
    this.hitConnected = false;
    this.freeze = false;
    this.armor = false;
    this.hitContactNow = false;
    this.stateTime = 0;
    this.prevStateTime = 0;
    this.invincible = false;
    this.blink = false;
    this.blinkOn = true;
    this.afterImages.on = false;
    this.afterImages.t = 0;
    this.hit = null;
    this.hitName = '';
    this.hitVictims.clear();
    this.special.on = false;
    this.state = st;
    const c = controlFlags(st.control);
    this.ctrl = [c[0], c[1], c[2]];
    this.triggers = st.triggers.slice();
    this.setPhys(st.phys);
    if (st.anim !== -1) this.changeAnim(st.anim);
    if (st.faceStick && this.pad) {
      const x = this.pad.x;
      if (x !== 0) this.facing = x > 0 ? 1 : -1;
    }
    for (const a of st.entry) this.act(a);
  }

  /** FUN_00410440: physics mode. */
  setPhys(m: number): void {
    if (m === -1) return;
    this.physMode = m;
    if (m === 0) {
      this.friction = this.desc.friction;
      this.gForce = 0;
      this.vel.y = 0;
      this.pos.y = 0;
    } else if (m === 1) {
      this.friction = 0;
      this.gForce = this.desc.gravity;
    }
  }

  changeAnim(id: number): void {
    const a = this.sprites.anims[String(id)];
    if (!a) return;
    this.anim.set(a, id);
  }

  // ---------------------------------------------------------------- update (Fighter::v3 @ 0040b160)
  update(dt: number): void {
    // FUN_0040b230: pause -> affect -> displacement timers
    let d = dt;
    if (this.pause > 0) {
      this.pause -= d;
      if (this.pause <= 0) { d = -this.pause; this.pause = 0; } else d = 0;
    }
    if (this.pause === 0 && this.affect > 0) {
      this.affect -= d;
      if (this.affect <= 0) { d = -this.affect; this.affect = 0; } else d = 0;
    }
    if (this.pause === 0 && this.affect === 0 && this.displace > 0) {
      this.displace -= d;
      if (this.displace <= 0) this.displace = 0;
    }
    const paused = this.pause > 0;
    if (!paused) this.anim.update(dt);
    if (this.pad) this.pad.update(dt);
    if (!paused && this.pad) this.controlTriggers();
    if (!paused) this.walk();
    if (!paused) this.physics(dt);
    this.stateUpdate(paused ? 0 : dt);
    if (this.shake.on) {
      this.shake.t -= dt;
      if (this.shake.t <= 0) this.shake.on = false;
    }
    this.hitContactNow = false;
    this.applyPending();
  }

  /** FUN_00402180: player/AI input triggers. */
  private controlTriggers(): void {
    for (const ct of this.controls) {
      const st = this.stateOf(ct.state);
      if (!st) continue;
      const allowed = st.type === 1 ? this.ctrl[1] : st.type === 2 ? this.ctrl[2] : st.type === 0 || st.type === 3 ? this.ctrl[0] : false;
      if (allowed && ct.conds.every((c) => this.cond(c))) this.changeState(ct.state);
    }
  }

  /** FUN_0040bea0: free walking in movable states. */
  private walk(): void {
    const st = this.state;
    if (!st || !st.move || !this.pad || this.affect !== 0 || this.displace !== 0) return;
    const sx = this.pad.x, sy = this.pad.y;
    if (sx === 0 && sy === 0) {
      if (!this.walking) return;
      this.walking = false;
      if (st.walkAnim === -1) return;
      this.changeAnim(st.anim);
      return;
    }
    // FUN_0040bea0: with a target the fighter always faces it (and may back away); otherwise it faces the stick.
    const t = this.target && !this.target.dead ? this.target : null;
    if (t && t.pos.x !== this.pos.x) this.facing = t.pos.x > this.pos.x ? 1 : -1;
    else this.facing = sx > 0 ? 1 : -1;
    const sp = this.desc.walkSpeed;
    this.vel.x = sp * sx;          // FUN_00410190: facing * (walkSpeed * stickX * facing)
    this.vel.z = sp * sy;
    if (!this.walking) {
      this.walking = true;
      if (st.walkAnim !== -1) this.changeAnim(st.walkAnim);
    }
  }

  /** FUN_00410190: velocity in facing space, clamped to max speed. */
  setVel(x: number, y: number, z: number): void {
    this.vel.x = this.facing * x;
    this.vel.y = y;
    this.vel.z = z;
  }

  /** FUN_00410230 + bat PhysicObject::update (0045dbb0). */
  private physics(dt: number): void {
    this.hasFallen = false;
    if (this.freeze) return;
    const ax = 0, ay = this.gForce, az = 0;
    const h = dt * dt * 0.5;
    const oldX = this.pos.x;
    this.pos.x += this.vel.x * dt + ax * h;
    this.pos.y += this.vel.y * dt + ay * h;
    this.pos.z += this.vel.z * dt + az * h;
    this.vel.x += ax * dt;
    this.vel.y += ay * dt;
    this.vel.z += az * dt;
    const fr = dt * this.friction;
    const sp2 = this.vel.x * this.vel.x + this.vel.y * this.vel.y + this.vel.z * this.vel.z;
    if (fr * fr < sp2) {
      const inv = 1 / Math.sqrt(sp2);
      this.vel.x -= fr * inv * this.vel.x;
      this.vel.y -= fr * inv * this.vel.y;
      this.vel.z -= fr * inv * this.vel.z;
    } else {
      this.vel.x = this.vel.y = this.vel.z = 0;
    }
    if (this.physMode === 1 && this.vel.y < 0 && this.pos.y <= 0) {
      this.hasFallen = true;
      this.pos.y = 0;
    }
    // area limits (x by collision width, z by the fighting area)
    const ar = this.fight.area;
    const half = this.desc.collisionWidth;
    let x = this.pos.x;
    if (x < oldX || this.vel.x < 0 || this.desc.collisionWidth > 0) {
      if (x - half < ar.x0 && this.vel.x <= 0 && oldX >= x) x = Math.min(oldX, ar.x0 + half);
    }
    if (x + half > ar.x0 + ar.w && this.vel.x >= 0 && oldX <= x) x = Math.max(oldX, ar.x0 + ar.w - half);
    this.pos.x = x;
    if (this.pos.z < ar.z0 && this.vel.z < 0) this.pos.z = ar.z0;
    if (this.pos.z > ar.z0 + ar.d && this.vel.z > 0) this.pos.z = ar.z0 + ar.d;
  }

  /** FUN_0040b900: state time, after-images, triggers. */
  private stateUpdate(dt: number): void {
    this.prevStateTime = this.stateTime;
    if (this.pause === 0) this.stateTime += dt;
    if (this.invTimed) {
      this.invTime -= dt;
      if (this.invTime <= 0) { this.invTimed = false; this.invTime = 0; }
    }
    if (this.afterImages.on) {
      this.afterImages.t += dt;
      if (this.afterImages.t > this.afterImages.every) {
        this.afterImages.t -= this.afterImages.every;
        this.makeClone(this.afterImages.life, this.afterImages.color, 0.1);
      }
    }
    if (this.blink) this.blinkOn = !this.blinkOn;
    for (let i = 0; i < this.triggers.length; i++) {
      const t = this.triggers[i];
      if (!t) continue;
      if (t.conds.every((c) => this.cond(c))) {
        for (const a of t.acts) this.act(a);
        if (!t.persist) this.triggers[i] = null;
      }
    }
  }

  /** FUN_0040be40. */
  private applyPending(): void {
    this.starting = false;
    if (this.memoGo && this.memo) {
      this.changeState(this.memo);
      this.memoGo = false;
    }
    if (this.pending && this.pause <= 0) {
      const p = this.pending;
      this.pending = null;
      this.enter(p.name, p.st);
    }
  }

  // ---------------------------------------------------------------- conditions
  cond(c: Cond): boolean {
    if ('and' in c) return c.and.every((x) => this.cond(x));
    if ('or' in c) return c.or.some((x) => this.cond(x));
    return this.condValue(c.c, c.p) === c.want;
  }

  private condValue(name: string, p?: Params): boolean {
    const i0 = p?.i?.[0] ?? 0;
    const f0 = p?.f?.[0] ?? 0;
    const pad = this.pad;
    switch (name) {
      case 'HitContactNow': return this.hitContactNow && (i0 === 3 || i0 === this.hitResult);
      case 'HitWasConnected': return this.hitConnected && (i0 === 3 || i0 === this.hitResult);
      case 'PreviousHitWasConnected': return this.prevHitConnected && (i0 === 3 || i0 === this.prevHitResult);
      case 'AnimEnd': return this.anim.ended;
      case 'AnimFrameNumArrived': return this.anim.frame === i0 && this.anim.prev !== i0;
      case 'IsWalkingAnim': return !!this.state?.move && this.walking;
      case 'HasArrivedActiveFrame': return this.anim.active;
      case 'HasArrivedPassiveFrame': return this.anim.passive;
      case 'HasEnoughLife': return this.life >= i0;
      case 'HasLife': return this.life > 0;
      case 'HasNoLife': return this.life === 0;
      case 'CollideWithWall': return this.collideWithWall();
      case 'FallVelLargerThan': return f0 < this.vel.y;
      case 'HasFallen': return this.hasFallen;
      case 'IsStateGround': return this.physMode === 0;
      case 'IsStateAir': return this.physMode === 1;
      case 'CollideWithBack': return false;
      case 'IsAltitudeLessThan': return this.pos.y < f0;
      case 'StateTimeArrived': return this.prevStateTime < f0 && f0 <= this.stateTime;
      case 'StateTimeLarger': return f0 < this.stateTime;
      case 'StateEquals': return this.stateName === (p?.s?.[0] ?? '');
      case 'PreviousStateEquals': return this.prevStateName === (p?.s?.[0] ?? '');
      case 'IsStartingState': return this.starting;
      case 'IsCpuCharacter': return this.cpu;
      case 'IsEvilCharacter': return this.evil;
      case 'IsStateTypeEquals': return this.state?.type === i0;
      case 'Always': return true;
      case 'IsBossCharacter': return this.boss;
      case 'IsPressed': return !!pad && pad.pressed(i0);
      case 'IsDown': return !!pad && pad.down(i0);
      case 'IsDownForward': return !!pad && (this.facing === 1 ? pad.x > 0.2 : pad.x < -0.2);
      case 'IsDownBack': return !!pad && (this.facing === -1 ? pad.x > 0.2 : pad.x < -0.2);
      case 'IsDownUp': return !!pad && pad.y < -0.2;
      case 'IsDownDown': return !!pad && pad.y > 0.2;
      case 'IsButtonBash': return !!pad && pad.bash > i0;
      case 'IsForwardDoubleTap': return !!pad && (this.facing === 1 ? pad.doubleRight() : pad.doubleLeft());
      case 'IsBackDoubleTap': return !!pad && (this.facing === -1 ? pad.doubleRight() : pad.doubleLeft());
      case 'IsFallTypeEquals': return !!this.recv && this.recv.fallType === i0;
      case 'IsDamageTypeEquals': return !!this.recv && this.recv.damageType === i0;
      case 'IsAimingTypeEquals': return !!this.recv && this.recv.aimType === i0;
      case 'DisplacementTimeEnd': return this.displace === 0;
      case 'AffectTimeEnd': return this.affect === 0;
      case 'IsFrontHit': return this.frontHit;
      case 'IsUpVel': return this.vel.y > 0;
      case 'HasPower': return this.usesPower ? this.power > 0 : true;
      case 'HasFullPower': return this.usesPower ? this.power === 300 : true;
      case 'HasEnoughPower': return this.usesPower ? i0 <= this.power : true;
      case 'HasEnoughPowerAndLife': return this.usesPower ? i0 < this.power + this.life : true;
    }
    return false;
  }

  private collideWithWall(): boolean {
    const ar = this.fight.area;
    const half = this.desc.collisionWidth;
    return (this.vel.x < 0 && this.pos.x - half <= ar.x0 + 0.01) || (this.vel.x > 0 && this.pos.x + half >= ar.x0 + ar.w - 0.01);
  }

  // ---------------------------------------------------------------- actions
  act(a: Act): void {
    const p = a.p ?? {};
    const i = p.i ?? [], f = p.f ?? [], s = p.s ?? [], b = p.b ?? [];
    switch (a.a) {
      case 'HitPerform': this.performHit(s[0]); break;
      case 'HitDefinitionChange': this.hit = FSM.hits[s[0]] ?? null; this.hitName = s[0]; break;
      case 'SetControlState': { const c = controlFlags(i[0]); this.ctrl = [c[0], c[1], c[2]]; break; }
      case 'ChangeAnim': this.changeAnim(i[0]); break;
      case 'ChangeState': this.changeState(s[0]); break;
      case 'MemoState': this.memo = s[0]; break;
      case 'SetMemoState': if (this.memo) this.memoGo = true; break;
      case 'SetPauseTime': this.pause = i[0] * TICK; break;
      case 'SetArmorMode': this.armor = true; break;
      case 'SetSpecialDamage':
        if (s[0]) this.special = { on: true, state: s[0], pause: i[0] * TICK, spark: i[1], flag: !!b[0] };
        else this.special.on = false;
        break;
      case 'SetPhysicState': this.setPhys(i[0]); break;
      case 'Death': this.fight.killFighter(this); break;
      case 'SetInvTime': this.invTimed = true; if (this.invTime < i[0] * TICK) this.invTime = i[0] * TICK; break;
      case 'SetInvincible': this.invincible = true; break;
      case 'PowerAdd': this.addPower(i[0]); break;
      case 'PowerConsume': if (this.usesPower) this.power = Math.max(0, this.power - i[0]); break;
      case 'PowerConsumeOrLife': this.consumePowerOrLife(i[0]); break;
      case 'SpecialProtagonism': this.fight.protagonism(this, f[0]); break;
      case 'ShakeGround': this.fight.shakeGround(i[0], i[1]); break;
      case 'ShakeWalls': this.fight.shakeWalls(i[0], i[1]); break;
      case 'PlayGeneralSound': playSound(s[0]); break;
      case 'PlayCharacterSound': break;
      case 'DramaticSlowMotion': this.fight.slowMotion(f[0], f[1]); break;
      case 'Blink': break;
      case 'Shake': this.shake = { on: true, amp: i[0], t: i[1] * TICK, max: i[1] * TICK }; break;
      case 'AfterImages':
        this.afterImages = { on: true, t: 0, every: i[3] * TICK, life: i[4], color: [1, i[0] / 255, i[1] / 255, i[2] / 255] };
        break;
      case 'EndAfterImages': this.afterImages.on = false; break;
      case 'MakeCloneImage': this.makeClone(i[0], [1, 1, 1, 1], 0.1); break;
      case 'MakeCharacterAnimEffect': break;
      case 'MakeGeneralSpark': this.fight.addSpark(i[0], b[0] ? this.pos.x + this.facing * i[1] : i[1], b[0] ? this.pos.y + i[2] : i[2], b[0] ? this.pos.z + i[3] : i[3], b[0] && this.facing < 0 ? -1 : 1); break;
      case 'StartDialog': break;
      case 'VisibilityBlink': this.blink = true; break;
      case 'AirToStandGroundEffect': case 'StandToAirGroundEffect': break;
      case 'ForceFriction': this.friction = f[0]; break;
      case 'ForceGravity': this.gForce = f[0]; break;
      case 'TurnFacing': this.facing = -this.facing; break;
      case 'VelAdd': this.vel.x += f[0]; this.vel.y += f[1]; this.vel.z += f[2]; break;
      case 'VelSet': this.setVel(f[0], f[1], f[2]); break;
      case 'VelSetX': this.vel.x = this.facing * f[0]; break;
      case 'VelSetY': this.vel.y = f[0]; break;
      case 'VelSetZ': this.vel.z = f[0]; break;
      case 'VelScale': this.vel.x *= f[0]; this.vel.y *= f[1]; this.vel.z *= f[2]; break;
      case 'FreezePhysics': this.freeze = true; break;
      case 'SetReceivedVel': {
        const v = this.physMode === 0 ? this.recvGround : this.recvAir;
        this.vel.x = v.x; this.vel.y = v.y; this.vel.z = v.z;
        break;
      }
      case 'SetReceivedForceGravity': break;
      case 'SetFacingToAggressor':
        if (this.recv) {
          if (this.recvAttackerX < this.pos.x) this.facing = -1;
          else if (this.pos.x < this.recvAttackerX) this.facing = 1;
        }
        break;
      case 'ApplyReceivedDamage':
        if (this.recv && this.recvDamage > 0) { this.damage(this.recvDamage, true); this.recvDamage = 0; }
        break;
    }
  }

  addPower(n: number): void { if (this.usesPower) this.power = Math.min(300, this.power + n); }

  /** v91: pay with power first, the rest with life (never below 1). */
  private consumePowerOrLife(n: number): void {
    if (!this.usesPower) return;
    if (this.power < n) {
      const rest = n - this.power;
      this.power = 0;
      if (rest < this.life) this.life -= rest;
      else this.life = 1;
      if (this.life < 0) this.life = 0;
    } else {
      this.power -= n;
    }
  }

  /** Fighter::v49: start a hit. */
  private performHit(name: string): void {
    this.hit = FSM.hits[name] ?? null;
    this.hitName = name;
    this.hitVictims.clear();
  }

  private makeClone(lifeTicks: number, color: [number, number, number, number], alpha: number): void {
    const f = this.frame;
    if (!f) return;
    const life = lifeTicks * TICK;
    this.fight.clones.push({ img: f.img, sheet: this.sheet, x: this.pos.x, y: this.pos.y, z: this.pos.z - 0.01, facing: this.facing, ox: f.ox, oy: f.oy, flip: f.flip, life, max: life, color: [alpha, color[1], color[2], color[3]], char: this.desc.dataKey } as Clone & { char: string });
  }

  /** FUN_0040d090: subtract life (negative heals); at 0 an immediate death if asked. */
  damage(n: number, immediate: boolean): void {
    if (this.fight.lifeEnabled(this)) {
      if (n > 0) this.life = Math.max(0, this.life - n);
      else if (n < 0) this.life = Math.min(this.lifeMax, this.life - n);
    }
    if (this.life === 0 && immediate) {
      const st = this.stateOf('Dead');
      this.pending = null;
      if (st) this.enter('Dead', st);
    }
  }

  // ---------------------------------------------------------------- hits (IHitFighter @ +0x154)
  canBeHit(): boolean {
    return !this.invincible && !this.invTimed && !this.dead;
  }

  /** Fighter::v9 (0040c4f0): this fighter receives `h` from `att`. */
  receiveHit(h: HitDef, att: Fighter): void {
    this.recv = h;
    this.lastAttacker = att;
    this.recvAttackerX = att.pos.x;
    const attFacing = att.facing;
    if (!h.b30) {
      if (h.b31) {
        this.facing = attFacing === 1 ? -1 : 1;
        this.frontHit = true;
      } else {
        this.frontHit = attFacing !== this.facing;
      }
    } else if (!h.b31) {
      this.frontHit = attFacing !== this.facing;
    } else {
      this.frontHit = true;
      if (this.recvAttackerX > this.pos.x) this.facing = 1;
      else if (this.recvAttackerX < this.pos.x) this.facing = -1;
    }
    this.recvAir = { x: h.avx, y: h.avy, z: h.avz };
    this.recvGround = { x: h.vx, y: h.vy, z: h.vz };
    if (!h.b30) {
      this.recvAir.x *= attFacing;
      this.recvGround.x *= attFacing;
    } else if (this.recvAttackerX >= this.pos.x) {
      this.recvAir.x *= -1;
      this.recvGround.x *= -1;
    }
    let goTo = 'Damage';
    if (this.special.on) {
      goTo = this.special.state;
    } else {
      let dmg = h.damage;
      if (this.armor || this.armorMode) {
        // armored (0x2f5 state armor / 0x2f6 armorMode): half damage, pushed back, shaken, no state change
        dmg = Math.max(1, Math.trunc(dmg / 2));
        goTo = '';
        this.recvGround.x *= 0.75; this.recvGround.y *= 0.75; this.recvGround.z *= 0.75;
        const v = this.physMode === 0 ? this.recvGround : this.recvAir;
        this.vel.x = v.x; this.vel.y = v.y; this.vel.z = v.z;
        if (h.damageType === 11) this.shake = { on: true, amp: 1, t: h.pauseV * TICK, max: h.pauseV * TICK };
        else if (h.damageType === 12) this.shake = { on: true, amp: 3, t: h.pauseV * TICK, max: h.pauseV * TICK };
      }
      this.recvDamage = dmg;
      this.damage(dmg, false);
      if (this.life === 0) { goTo = 'Dead'; }
      this.addPower(h.powerV);
    }
    if (goTo) this.forceState(goTo);
    this.pause = h.pauseV * TICK;
    this.affect = h.affect * TICK;
    if (h.sound) playSound(h.sound);
  }

  /** Fighter::v10 (0040c8b0): our hit `h` connected on `vic` at rect `r` (intersection, screen space). */
  hitConnect(h: HitDef, r: Rect, vic: Fighter): void {
    this.hitContactNow = true;
    this.hitConnected = true;
    this.hitResult = 1;
    this.pause = h.pauseA * TICK + (vic.special.on ? vic.special.pause : 0);
    this.addPower(h.powerA);
    let spark = h.spark;
    if (vic.special.on && vic.special.spark !== -1) spark = vic.special.spark;
    if (spark >= 0) {
      // random point of the intersection rect, drawn in front of both fighters
      const sx = r[0] + Math.random() * r[2];
      const sy = r[1] + Math.random() * r[3];
      const z = Math.max(this.pos.z, vic.pos.z) + 1;
      // back from screen space to world (screenY = z/2 - y)
      this.fight.addSpark(spark, sx, z * 0.5 - sy, z, this.facing);
    }
  }

  /** Red/blue rects in screen space: [x, y, w, h]. */
  rects(kind: 'body' | 'hit'): [number, number, number, number][] {
    const f = this.frame;
    if (!f) return [];
    const sx = Math.floor(this.pos.x + 0.5);
    const sy = Math.floor(this.pos.z * 0.5 - this.pos.y + 0.5);
    return f[kind].map((r) => {
      const x1 = this.facing === 1 ? r[0] : -r[2];
      const x2 = this.facing === 1 ? r[2] : -r[0];
      return [sx + x1 + this.facing * f.ox, sy + r[1] + f.oy, x2 - x1, r[3] - r[1]] as [number, number, number, number];
    });
  }

  zDistanceOk(o: Fighter): boolean { return Math.abs(this.pos.z - o.pos.z) < Z_HIT_RANGE; }
}

/** ControlState presets (FUN_004189c0): [types 0/3, type 1, type 2]. */
export function controlFlags(n: number | null): [boolean, boolean, boolean] {
  switch (n) {
    case 0: return [true, true, true];
    case 1: return [false, false, false];
    case 2: return [true, false, false];
    case 3: return [false, true, true];
    case 4: return [false, false, true];
  }
  return [true, true, true];
}
