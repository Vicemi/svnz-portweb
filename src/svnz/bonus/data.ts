// "Bonus Bosses": characters of XA (the boss and the hero) integrated into the SVNZ fight engine as a separate mode.
// Everything here is data for the existing engine: FSM states, hit definitions, control triggers, AI tables,
// character descriptors, waves and menu entries. The original SVNZ game data is not touched.
//
// XA mechanics kept:
//   boss  - walks, cannon fan of 5 shots (60..120 degrees, 200 px/s) with the "gun" pose, killed by 200 hits (life 220 here,
//           armoured so a hit never staggers it), touching it hurts, explosion + shake when it dies.
//   hero  - walks, jumps and DOUBLE jumps, fires the energy ball, flinches/falls/gets up when hit.
// New for SVNZ: both move on the 2.5D plane (stalk, keep distance, approach, wait) with their own AI tables and their shots
// drift in depth to reach the target's plane. Sounds are XA's own (assets/xa/fx); music stays SVNZ's.
import { FSM } from '../fight/fighter';
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
  const strong = FSM.hits.Common_StrongHit;
  FSM.hits.XaBall = { ...weak, damage: 7, pauseA: 0, pauseV: 4, affect: 12, sound: 'xa_hurt', spark: 60, vx: 90, avx: 90, avy: 120, powerA: 0 } as HitDef;
  FSM.hits.XaBullet = { ...weak, damage: 8, pauseA: 0, pauseV: 4, affect: 10, sound: 'xa_hurt', spark: 60, vx: 80, avx: 80, avy: 100, powerA: 0 } as HitDef;
  FSM.hits.XaBossTouch = { ...strong, damage: 14, pauseA: 3, pauseV: 8, affect: 22, sound: 'xa_hurt', vx: 220, vy: 160, avx: 220, avy: 200, fallType: 2, spark: 20 } as HitDef;

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
  const human = FSM.dicts.Human_FighterStates.map;
  FSM.dicts.XaHero_FighterStates = {
    base: 'Human_FighterStates',
    map: { ...human, Intro1: 'XaHero_Intro1', Jump: 'XaHero_Jump', DoubleJump: 'XaHero_DoubleJump', Attack: 'XaHero_Shoot' },
  };
  FSM.controls.XaHero_Control = [
    { state: 'Jump', conds: [c('IsPressed', true, { i: [0] }), c('IsStateGround')] },
    { state: 'DoubleJump', conds: [c('IsPressed', true, { i: [0] }), c('IsStateAir'), c('StateEquals', true, { s: ['Jump'] })] },
    { state: 'Attack', conds: [c('IsPressed', true, { i: [1] }), c('IsStateGround')] },
  ];

  // ------------------------------------------------------------------ XA boss
  FSM.states.XaBoss_Intro1 = state({ anim: 0, phys: 1, control: 1, triggers: [trig([c('HasFallen')], [a('ShakeGround', { i: [4, 24] }), a('ChangeState', { s: ['Stand'] })])] });
  FSM.states.XaBoss_Stand = state({
    anim: 0, move: true, walkAnim: 10, f4c: 1, control: 0, type: 0, phys: 0,
    // touching the boss hurts (XA: contact = death): re-arm the contact hit every walk cycle
    entry: [a('HitPerform', { s: ['XaBossTouch'] })],
    triggers: [trig([c('AnimFrameNumArrived', true, { i: [0] })], [a('HitPerform', { s: ['XaBossTouch'] })], true)],
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
    triggers: [trig([c('StateTimeLarger', true, { f: [4] })], [a('Death')])],   // the explosion keeps popping for ~4 s
  });
  FSM.dicts.XaBoss_FighterStates = {
    base: 'Human_FighterStates',
    map: { ...human, Intro1: 'XaBoss_Intro1', Stand: 'XaBoss_Stand', Attack: 'XaBoss_Shoot', Dead: 'XaBoss_Dead' },
  };
  FSM.controls.XaBoss_Control = [{ state: 'Attack', conds: [c('IsPressed', true, { i: [1] }), c('IsStateGround')] }];

  // ------------------------------------------------------------------ AI (SVNZ plane: x, depth z)
  const P = (sit: string, w: number, buckets: [number, string, number[]?][], params: ['s', string][] = []): AIPart => ({
    sit, w, params, buckets: buckets.map(([bw, r, ip]) => ({ w: bw, r, params: (ip ?? []).map((n) => ['i', n] as ['i', number]) })),
  });
  const FIND = P('Default', 0, [[1, 'Wait', [10]], [1, 'RandomWalk'], [13, 'FindClosestTarget']]);
  registerAI('XaBoss_Decisions_AI', [
    P('HasTarget', 20, [[40, 'StalkTarget'], [20, 'MidToTarget'], [25, 'LongToTarget'], [15, 'Wait', [45]], [10, 'StayAway']]),
    FIND,
  ]);
  registerAI('XaBoss_Reflexes_AI', [
    P('LongToTarget', 220, [[40, 'PressButtonAimingToTarget', [1]]]),
  ]);
  registerAI('XaHero_Decisions_AI', [
    P('HasTarget', 20, [[30, 'StalkTarget'], [25, 'MidToTarget'], [15, 'LongToTarget'], [15, 'Wait', [30]], [25, 'StayAway'], [10, 'CloseToTarget']]),
    FIND,
  ]);
  registerAI('XaHero_Reflexes_AI', [
    P('StateEquals', 60, [[25, 'PressButton', [0]]], [['s', 'Jump']]),                 // second jump in the air
    P('CloseToTarget', 60, [[25, 'PressButton', [0]], [20, 'StayAway'], [25, 'PressButtonAimingToTarget', [1]]]),
    P('MidToTarget', 40, [[40, 'PressButtonAimingToTarget', [1]], [12, 'PressButton', [0]]]),
    P('LongToTarget', 60, [[25, 'PressButtonAimingToTarget', [1]], [8, 'PressButton', [0]]]),
  ]);

  // ------------------------------------------------------------------ characters
  const base = {
    color: 0, state: 'Stand', friction: 1200, gravity: -1200, strength: 1, lifeHuman: 300, blendMode: 'DEFAULT', tintColor: '', numberOfPalettes: 1,
    controlTriggersHuman: '', controlTriggersCPU: '',
  };
  DB.chars.XaBoss = {
    base: {
      ...base, key: 'XaBoss', alias: 'XA Boss', dataKey: 'XaBoss', statesDictionary: 'XaBoss_FighterStates', controlTriggersHuman: 'XaBoss_Control', controlTriggersCPU: 'XaBoss_Control',
      decisionsAI: 'XaBoss_Decisions_AI', reflexesAI: 'XaBoss_Reflexes_AI', reflexesFrequency: 20, collisionWidth: 64, armorMode: true, lifeCPU: 220,
      closeAttackDist: 60, midAttackDist: 150, longAttackDist: 270, walkSpeed: 45,
    }, names: [], generic: [],
  };
  DB.chars.XaHero = {
    base: {
      ...base, key: 'XaHero', alias: 'XA', dataKey: 'XaHero', statesDictionary: 'XaHero_FighterStates', controlTriggersHuman: 'XaHero_Control', controlTriggersCPU: 'XaHero_Control',
      decisionsAI: 'XaHero_Decisions_AI', reflexesAI: 'XaHero_Reflexes_AI', reflexesFrequency: 12, collisionWidth: 24, armorMode: false, lifeCPU: 300,
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
