// Data shapes: src/svnz/data/fsm.json (tools/build_fsm.py, decoded from svnz.exe) and chars.json
// (tools/build_chars.py, from the FighterFactory .xml/.fgt files).

export interface Params { i?: number[]; f?: number[]; s?: string[]; b?: boolean[] }
export interface Act { a: string; p?: Params }
export type Cond = { c: string; want: boolean; p?: Params } | { and: Cond[] } | { or: Cond[] };
export interface Trig { persist: boolean; conds: Cond[]; acts: Act[] }
export interface FState {
  name?: string;
  anim: number;       // +0x3c default anim (-1 none)
  move: boolean;      // +0x40 the stick walks the fighter
  walkAnim: number;   // +0x44
  f48: number;
  f4c: number;
  faceStick: boolean; // +0x50 turn to the stick on entry
  control: number | null; // ControlState preset
  type: number;       // +0x74 0 basic, 1 attack, 2 special, 3 damage, 4 other
  phys: number;       // +0x78 0 ground, 1 air, 2 unchanged
  entry: Act[];
  triggers: Trig[];
}
export interface ControlTrig { state: string; conds: Cond[] }
export interface HitDef {
  vx: number; vy: number; vz: number; avx: number; avy: number; avz: number;
  damage: number; pauseA: number; pauseV: number; affect: number; b30: boolean; b31: boolean;
  fallType: number; damageType: number; aimType: number; sound: string; spark: number;
  target: number; priority: number; powerV: number; powerA: number; [k: string]: unknown;
}
export interface FsmData {
  states: Record<string, FState>;
  dicts: Record<string, { base: string | null; map: Record<string, string> }>;
  controls: Record<string, ControlTrig[]>;
  hits: Record<string, HitDef>;
}

export type Rect = [number, number, number, number];
/** `mz`: muzzle of the weapon in this picture (x forward, y up negative like the rects) - XA bonus characters. */
export interface Frame { img: string; ox: number; oy: number; t: number; flip: string; body: Rect[]; hit: Rect[]; mz?: [number, number] }
export interface Anim { loop: number; frames: Frame[] }
export interface CharSprites {
  /** Render scale of the pictures (XA bonus characters; rects are already scaled in the data). */
  scale?: number;
  sheets: string[];
  images: Record<string, [number, number, number, number, number, number]>;
  anims: Record<string, Anim>;
}

/** characters.xml defaultValues merged with a name entry. */
export interface CharDesc {
  key: string;          // xml element (Mina, DemonNinja, GoldDemonNinja...)
  alias: string;
  dataKey: string;
  color: number;
  statesDictionary: string;
  state: string;
  controlTriggersHuman: string;
  controlTriggersCPU: string;
  decisionsAI: string;
  reflexesAI: string;
  reflexesFrequency: number;
  friction: number;
  gravity: number;
  collisionWidth: number;
  strength: number;
  armorMode: boolean;
  lifeHuman: number;
  lifeCPU: number;
  closeAttackDist: number;
  midAttackDist: number;
  longAttackDist: number;
  blendMode: string;
  tintColor: string;
  walkSpeed: number;
  numberOfPalettes: number;
}
