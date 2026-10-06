// "Bonus Bosses": characters of XA (the boss and the hero) integrated into the SVNZ fight engine as a separate mode.
// Everything here is data for the existing engine: FSM states, hit definitions, control triggers, AI tables,
// character descriptors, waves and menu entries. The original SVNZ game data is not touched.
//
// XA mechanics kept:
//   boss  - walks, cannon fan of 5 shots (60..120 degrees, 200 px/s) with the "gun" pose, armoured (halved damage, never
//           staggers), explosion + shake when it dies. Touching it does NOT hurt (Mina is mostly melee).
// Power-up: a ninja star on the map gives Mina 20 s of ranged stars (W / Q attack keys), thrown with Mina's own fast-attack animation.
//   hero  - walks, jumps and DOUBLE jumps, fires the energy ball, flinches/falls/gets up when hit, and has the SHIELD
//           (BLOCK_IN/OUT): raised toward the target it stops weak frontal hits (4th one in a row breaks it); strong hits pass.
// Shots leave from the weapon's muzzle of the current picture (frame.mz, measured on the XA sheets).
// Deaths: boss = BOSS_DEAD + chained explosions + shake; hero = HERO_DEATH explosion after the hit pose, then it vanishes.
// New for SVNZ: both move on the 2.5D plane (stalk, keep distance, approach, wait) with their own AI tables and their shots
// drift in depth to reach the target's plane. Sounds are XA's own (assets/xa/fx); music stays SVNZ's.
import { FSM, CHARS } from '../fight/fighter';
import { registerAI, type AIPart } from '../fight/ai';
import { DB } from '../fight/data';
import type { Cond, FState, HitDef } from '../fight/types';

const c = (name: string, want = true, p?: { i?: number[]; f?: number[]; s?: string[] }): Cond => ({ c: name, want, ...(p ? { p } : {}) });
const a = (name: string, p?: { i?: number[]; f?: number[]; s?: string[]; b?: boolean[] }) => ({ a: name, ...(p ? { p } : {}) });
const trig = (conds: Cond[], acts: ReturnType<typeof a>[], persist = false) => ({ persist, conds, acts });
const state = (o: Partial<FState>): FState => ({
  anim: 0, move: false, walkAnim: -1, f48: 0, f4c: 0, faceStick: false, control: 0, type: 0, phys: 0, entry: [], triggers: [], ...o,
});

export const BONUS_LEVEL = 'bonusXaLevel';

export function registerBonus(): void {
  // ------------------------------------------------------------------ hits
  const weak = FSM.hits.Common_WeakHit;
  FSM.hits.XaBall = { ...weak, damage: 7, pauseA: 0, pauseV: 4, affect: 12, sound: 'xa_hurt', spark: 60, vx: 90, avx: 90, avy: 120, powerA: 0 } as HitDef;
  FSM.hits.XaBullet = { ...weak, damage: 8, pauseA: 0, pauseV: 4, affect: 10, sound: 'xa_hurt', spark: 60, vx: 80, avx: 80, avy: 100, powerA: 0 } as HitDef;
  FSM.hits.NinjaStar = { ...weak, damage: 10, pauseA: 0, pauseV: 3, affect: 14, vx: 70, avx: 70, avy: 140, powerA: 0, powerV: 1 } as HitDef;

  // ------------------------------------------------------------------ XA hero
  FSM.states.XaHero_Intro1 = state({ anim: 20, phys: 1, control: 1, triggers: [trig([c('HasFallen')], [a('PlayGeneralSound', { s: ['xa_entrance'] }), a('ChangeState', { s: ['Stand'] })])] });
  FSM.states.XaHero_Jump = state({
    anim: 20, move: true, f48: 110, control: 2, type: 0, phys: 1,
    entry: [a('VelSetY', { f: [520] }), a('PlayGeneralSound', { s: ['xa_jump'] })],
    triggers: [trig([c('HasFallen')], [a('ChangeState', { s: ['Stand'] })])],
  });
  FSM.states.XaHero_DoubleJump = state({
    anim: 20, move: true, f48: 110, control: 2, type: 0, phys: 1,
    entry: [a('VelSetY', { f: [470] }), a('PlayGeneralSound', { s: ['xa_double_jump'] })],
    triggers: [trig([c('HasFallen')], [a('ChangeState', { s: ['Stand'] })])],
  });
  FSM.states.XaHero_Shoot = state({
    anim: 30, faceStick: true, control: 4, type: 1, phys: 0,
    entry: [a('VelSetZ', { f: [0] })],
    triggers: [
      trig([c('AnimFrameNumArrived', true, { i: [1] })], [
        a('Shoot', { s: ['XaBall'], i: [2, 26, 28, 330], b: [true] }),
        a('PlayGeneralSound', { s: ['xa_bullet'] }),
      ]),
      trig([c('AnimEnd')], [a('ChangeState', { s: ['Stand'] })]),
    ],
  });
  // shield: BLOCK_IN (frames 22..25), guard up from the first tick, held at least .45 s (button) and at most 1.1 s, then BLOCK_OUT
  FSM.states.XaHero_Block = state({
    anim: 50, faceStick: true, control: 4, type: 1, phys: 0,
    entry: [a('VelSetZ', { f: [0] }), a('GuardOn'), a('PlayGeneralSound', { s: ['xa_shield'] })],
    triggers: [
      trig([c('StateTimeLarger', true, { f: [0.45] }), c('IsDown', false, { i: [2] })], [a('ChangeState', { s: ['Unblock'] })]),
      trig([c('StateTimeLarger', true, { f: [1.1] })], [a('ChangeState', { s: ['Unblock'] })]),
    ],
  });
  FSM.states.XaHero_Unblock = state({ anim: 60, control: 2, type: 1, phys: 0, triggers: [trig([c('AnimEnd')], [a('ChangeState', { s: ['Stand'] })])] });
  // death: the hit pose, then the XA player-death explosion (HERO_DEATH) and the body is gone
  FSM.states.XaHero_Dead = state({
    anim: 5500, control: 1, type: 3, phys: 0,
    entry: [a('FreezePhysics'), a('ShakeGround', { i: [3, 30] })],
    triggers: [
      trig([c('StateTimeArrived', true, { f: [0.12] })], [a('PlayGeneralSound', { s: ['xa_hero_death'] }), a('XaSpark', { i: [10, 0, 26, 0] }), a('DramaticSlowMotion', { f: [0.5, 0.5] })]),
      trig([c('StateTimeArrived', true, { f: [0.2] })], [a('Hide'), a('XaSpark', { i: [10, 0, 34, 14] })]),
      trig([c('StateTimeArrived', true, { f: [0.5] })], [a('XaSpark', { i: [10, 0, 20, 18] })]),
      trig([c('StateTimeLarger', true, { f: [1.5] })], [a('Death')]),
    ],
  });
  const human = FSM.dicts.Human_FighterStates.map;
  FSM.dicts.XaHero_FighterStates = {
    base: 'Human_FighterStates',
    map: { ...human, Intro1: 'XaHero_Intro1', Jump: 'XaHero_Jump', DoubleJump: 'XaHero_DoubleJump', Attack: 'XaHero_Shoot', Block: 'XaHero_Block', Unblock: 'XaHero_Unblock', Dead: 'XaHero_Dead' },
  };
  FSM.controls.XaHero_Control = [
    { state: 'Jump', conds: [c('IsPressed', true, { i: [0] }), c('IsStateGround')] },
    { state: 'DoubleJump', conds: [c('IsPressed', true, { i: [0] }), c('IsStateAir'), c('StateEquals', true, { s: ['Jump'] })] },
    { state: 'Attack', conds: [c('IsPressed', true, { i: [1] }), c('IsStateGround')] },
    { state: 'Block', conds: [c('IsPressed', true, { i: [2] }), c('IsStateGround')] },
  ];

  // ------------------------------------------------------------------ XA boss
  FSM.states.XaBoss_Intro1 = state({ anim: 0, phys: 1, control: 1, triggers: [trig([c('HasFallen')], [a('ShakeGround', { i: [4, 24] }), a('ChangeState', { s: ['Stand'] })])] });
  FSM.states.XaBoss_Stand = state({
    anim: 0, move: true, walkAnim: 10, f4c: 1, control: 0, type: 0, phys: 0,
  });
  FSM.states.XaBoss_Shoot = state({
    anim: 20, faceStick: true, control: 4, type: 1, phys: 0,
    entry: [a('VelSetZ', { f: [0] })],
    triggers: [
      // BOSS_SHOOT frame 1 is the muzzle flash; the cannon sits ~34 px ahead and ~71 px up in the XA picture (x0.62)
      trig([c('AnimFrameNumArrived', true, { i: [1] })], [
        a('ShootFan', { s: ['XaBullet'], i: [1, 21, 44, 200, 5] }),
        a('PlayGeneralSound', { s: ['xa_cannon'] }),
      ]),
      trig([c('AnimEnd')], [a('ChangeState', { s: ['Stand'] })]),
    ],
  });
  FSM.states.XaBoss_Dead = state({
    anim: 5500, control: 1, type: 3, phys: 0,
    entry: [a('FreezePhysics'), a('PlayGeneralSound', { s: ['xa_death'] }), a('ShakeGround', { i: [6, 120] }), a('DramaticSlowMotion', { f: [0.6, 0.4] })],
    // BOSS_DEAD plays its own explosion; chained blasts over the body (XA: ENEMY_DEATH bursts) and a last one at the end
    triggers: [
      ...[0.3, 0.7, 1.1, 1.5, 1.9, 2.3, 2.7, 3.1].map((t, k) =>
        trig([c('StateTimeArrived', true, { f: [t] })], [a('XaSpark', { i: [k % 2 ? 10 : 1, (k % 3 - 1) * 20, 55, 40] }), ...(k % 2 ? [a('PlayGeneralSound', { s: ['xa_cannon'] })] : [])])),
      trig([c('StateTimeLarger', true, { f: [4] })], [a('Death')]),   // the explosion keeps popping for ~4 s
    ],
  });
  FSM.dicts.XaBoss_FighterStates = {
    base: 'Human_FighterStates',
    map: { ...human, Intro1: 'XaBoss_Intro1', Stand: 'XaBoss_Stand', Attack: 'XaBoss_Shoot', Dead: 'XaBoss_Dead' },
  };
  FSM.controls.XaBoss_Control = [{ state: 'Attack', conds: [c('IsPressed', true, { i: [1] }), c('IsStateGround')] }];

  // ------------------------------------------------------------------ ninja stars (Mina)
  // anim 7000 = FastAttack's own animation (1000): the arm swings out at frame 2 - the star leaves the hand there (frame.mz)
  const fa = CHARS.Mina.anims['1000'].frames;
  const hand: [number, number] = [32, -21];
  CHARS.Mina.anims['7000'] = {
    loop: -1,
    frames: fa.map((fr, k) => ({ ...fr, hit: [], ...(k === 2 || k === 3 ? { mz: hand } : {}) })),
  };
  FSM.states.Mina_StarThrow = state({
    anim: 7000, faceStick: true, control: 4, type: 1, phys: 0,
    entry: [a('VelSet', { f: [0, 0, 0] })],
    triggers: [
      trig([c('AnimFrameNumArrived', true, { i: [2] })], [a('ThrowStar', { s: ['NinjaStar'] }), a('PlayGeneralSound', { s: ['weakSlash'] })]),
      trig([c('AnimEnd')], [a('ChangeState', { s: ['Stand'] })]),
    ],
  });
  FSM.dicts.Mina_FighterStates.map.StarThrow = 'Mina_StarThrow';
  if (!FSM.controls.Mina_Control.some((t) => t.state === 'StarThrow')) {
    // while the power-up lasts both attack keys throw: W (button 2) and Q (button 1)
    for (const b of [2, 1]) FSM.controls.Mina_Control.unshift({ state: 'StarThrow', conds: [c('HasStars'), c('IsPressed', true, { i: [b] }), c('IsStateGround')] });
  }

  // ------------------------------------------------------------------ AI (SVNZ plane: x, depth z)
  const P = (sit: string, w: number, buckets: [number, string, number[]?][], params: ['s', string][] = []): AIPart => ({
    sit, w, params, buckets: buckets.map(([bw, r, ip]) => ({ w: bw, r, params: (ip ?? []).map((n) => ['i', n] as ['i', number]) })),
  });
  const FIND = P('Default', 0, [[1, 'Wait', [10]], [1, 'RandomWalk'], [13, 'FindClosestTarget']]);
  // Boss: a slow turret. Lines up in depth with the target (the fan only reaches its plane), keeps its distance, fires at once
  // when the target is on top of it or in the air, otherwise from range.
  registerAI('XaBoss_Decisions_AI', [
    P('TargetOffDepth', 10, [[60, 'AlignDepth'], [20, 'StayAway'], [10, 'Wait', [20]]]),
    P('HasTarget', 20, [[20, 'StalkTarget'], [20, 'MidToTarget'], [25, 'LongToTarget'], [15, 'Wait', [45]], [10, 'StayAway'], [15, 'AlignDepth']]),
    FIND,
  ]);
  registerAI('XaBoss_Reflexes_AI', [
    P('CloseToTarget', 40, [[45, 'PressButtonAimingToTarget', [1]], [20, 'StayAway']]),
    P('TargetAirborne', 60, [[40, 'PressButtonAimingToTarget', [1]]]),
    P('LongToTarget', 120, [[70, 'PressButtonAimingToTarget', [1]]]),
  ]);
  // Hero: keeps the shield for what the target does (attack in range, target on top of it, hurt), shoots from range,
  // double-jumps away from trouble and lines up in depth to shoot.
  registerAI('XaHero_Decisions_AI', [
    P('LowLife', 20, [[40, 'StayAway'], [30, 'LongToTarget'], [20, 'Wait', [25]]]),
    P('TargetOffDepth', 10, [[40, 'AlignDepth'], [20, 'StalkTarget'], [10, 'Wait', [15]]]),
    P('HasTarget', 20, [[25, 'StalkTarget'], [25, 'MidToTarget'], [15, 'LongToTarget'], [15, 'Wait', [30]], [25, 'StayAway'], [8, 'CloseToTarget']]),
    FIND,
  ]);
  registerAI('XaHero_Reflexes_AI', [
    P('TargetAttacking', 12, [[55, 'PressButtonAimingToTarget', [2]], [25, 'JumpAway', [0]], [15, 'PressButtonAimingToTarget', [1]]]),
    P('StateEquals', 60, [[25, 'PressButton', [0]]], [['s', 'Jump']]),                 // second jump in the air
    P('TargetAirborne', 45, [[30, 'PressButtonAimingToTarget', [2]], [15, 'JumpAway', [0]]]),
    P('CloseToTarget', 45, [[22, 'PressButtonAimingToTarget', [2]], [18, 'JumpAway', [0]], [18, 'StayAway'], [30, 'PressButtonAimingToTarget', [1]]]),
    P('MidToTarget', 35, [[45, 'PressButtonAimingToTarget', [1]], [10, 'PressButton', [0]], [8, 'PressButtonAimingToTarget', [2]]]),
    P('LongToTarget', 55, [[30, 'PressButtonAimingToTarget', [1]], [8, 'PressButton', [0]]]),
  ]);

  // ------------------------------------------------------------------ characters
  const base = {
    color: 0, state: 'Stand', friction: 1200, gravity: -1200, strength: 1, lifeHuman: 300, blendMode: 'DEFAULT', tintColor: '', numberOfPalettes: 1,
    controlTriggersHuman: '', controlTriggersCPU: '',
  };
  DB.chars.XaBoss = {
    base: {
      ...base, key: 'XaBoss', alias: 'XA Boss', dataKey: 'XaBoss', statesDictionary: 'XaBoss_FighterStates', controlTriggersHuman: 'XaBoss_Control', controlTriggersCPU: 'XaBoss_Control',
      decisionsAI: 'XaBoss_Decisions_AI', reflexesAI: 'XaBoss_Reflexes_AI', reflexesFrequency: 15, collisionWidth: 64, armorMode: true, lifeCPU: 220,
      closeAttackDist: 60, midAttackDist: 150, longAttackDist: 270, walkSpeed: 45,
    }, names: [], generic: [],
  };
  DB.chars.XaHero = {
    base: {
      ...base, key: 'XaHero', alias: 'XA', dataKey: 'XaHero', statesDictionary: 'XaHero_FighterStates', controlTriggersHuman: 'XaHero_Control', controlTriggersCPU: 'XaHero_Control',
      decisionsAI: 'XaHero_Decisions_AI', reflexesAI: 'XaHero_Reflexes_AI', reflexesFrequency: 7, collisionWidth: 24, armorMode: false, lifeCPU: 300,
      closeAttackDist: 60, midAttackDist: 140, longAttackDist: 240, walkSpeed: 100,
    }, names: [], generic: [],
  };

  // ------------------------------------------------------------------ level, waves, menu
  const text = { startTextKey: 'FIGHT!', failTextKey: 'YOU ARE DEAD...' };
  DB.levels[BONUS_LEVEL] = {
    key: BONUS_LEVEL, name: 'XA Boss & Hero', bg: 'arena', music: 'bgmBoss', playerTeam: 'singleTeamMina',
    waves: [
      { name: 'xaBossWave', music: 'bgmBoss', initialTextKey: 'The Boss Of XA Is Coming!', finalTextKey: 'GREAT!', ...text },
      { name: 'xaHeroWave', music: 'bgmNormal', initialTextKey: 'And Now... The Hero Of XA!', finalTextKey: 'INCREDIBLE!!', ...text },
    ],
  };
  const wave = (list: string) => ({ mode: 'BossMode', list, activeEnemies: 1, activeExtras: 0, loopIndex: 0, time: 0 });
  DB.waves.xaBossWave = wave('xaBossList');
  DB.waves.xaHeroWave = wave('xaHeroList');
  DB.lists.xaBossList = { team: 2, fighters: [{ type: 'XaBoss', nameIndex: 0, state: 'Intro1', yPos: 260, attrs: {} }] };
  DB.lists.xaHeroList = { team: 2, fighters: [{ type: 'XaHero', nameIndex: 0, state: 'Intro1', yPos: 320, attrs: {} }] };

  const first = DB.menus.firstMenu;
  if (first && !first.options.some((o) => o.link === 'bonusBosses')) {
    const exit = first.options.findIndex((o) => o.action === 'quitGame');
    first.options.splice(exit < 0 ? first.options.length : exit, 0, { textKey: 'Bonus Bosses', link: 'bonusBosses' });
  }
  DB.menus.bonusBosses = {
    cancel: 'Back',
    options: [{ textKey: 'XA Boss & Hero', action: BONUS_LEVEL }, { textKey: 'Back', link: 'firstMenu' }],
  };
}
