// SoundPackage "GeneralSounds" of svnz.exe (0043f2c0): sound key -> the game's own .ogg files.
import { loadArrayBuffer } from './assets';

const SOUNDS: Record<string, string> = {
  bgmNormal: 'assets/audio/music/bgm.ogg',
  bgmBoss: 'assets/audio/music/boss.ogg',
  weakHit: 'assets/audio/fx/fight/weakHit.ogg',
  strongHit: 'assets/audio/fx/fight/strongHit.ogg',
  weakSlash: 'assets/audio/fx/fight/weakCut.ogg',
  strongSlash: 'assets/audio/fx/fight/strongCut.ogg',
  jump: 'assets/audio/fx/fight/jump.ogg',
  fall: 'assets/audio/fx/fight/fall.ogg',
  action: 'assets/audio/fx/fight/action.ogg',
  step: 'assets/audio/fx/fight/step.ogg',
  special: 'assets/audio/fx/fight/special.ogg',
  storm: 'assets/audio/fx/stage/storm.ogg',
  // sounds of the XA characters (bonus bosses)
  xa_bullet: 'assets/xa/fx/bullet.ogg', xa_cannon: 'assets/xa/fx/bullet_cannon.ogg', xa_wall: 'assets/xa/fx/bullet_wall_1.ogg',
  xa_wall2: 'assets/xa/fx/bullet_wall_2.ogg', xa_death: 'assets/xa/fx/enemy_death.ogg', xa_shot: 'assets/xa/fx/enemy_shot.ogg',
  xa_jump: 'assets/xa/fx/jump_hero.ogg', xa_double_jump: 'assets/xa/fx/double_jump.ogg', xa_hurt: 'assets/xa/fx/hurt.ogg',
  xa_hero_death: 'assets/xa/fx/player_death.ogg', xa_entrance: 'assets/xa/fx/init_fall.ogg', xa_shield: 'assets/xa/fx/s_1.ogg', xa_shield2: 'assets/xa/fx/s_2.ogg',
  Mina_Dead: 'assets/audio/fx/fight/voices/mina/ko.ogg',
  Mina_Damage: 'assets/audio/fx/fight/voices/mina/damage.ogg',
  Mina_Action1: 'assets/audio/fx/fight/voices/mina/action1.ogg',
  Mina_Action2: 'assets/audio/fx/fight/voices/mina/action2.ogg',
  DemonNinja_Damage1: 'assets/audio/fx/fight/voices/demonNinja/damage1.ogg',
  DemonNinja_Damage2: 'assets/audio/fx/fight/voices/demonNinja/damage2.ogg',
};

let ctx: AudioContext | null = null;
let fxGain: GainNode, musicGain: GainNode;
const buffers = new Map<string, Promise<AudioBuffer | null>>();
let music: { src: AudioBufferSourceNode; name: string } | null = null;
let soundOn = true;
let musicOn = true;

function ac(): AudioContext {
  if (!ctx) {
    ctx = new AudioContext();
    fxGain = ctx.createGain();
    musicGain = ctx.createGain();
    fxGain.connect(ctx.destination);
    musicGain.connect(ctx.destination);
  }
  return ctx;
}

export function unlockAudio(): void {
  const c = ac();
  if (c.state === 'suspended') void c.resume();
}

function buffer(path: string): Promise<AudioBuffer | null> {
  let p = buffers.get(path);
  if (!p) {
    p = loadArrayBuffer(path).then((b) => (b ? ac().decodeAudioData(b) : null)).catch(() => null);
    buffers.set(path, p);
  }
  return p;
}

export function preloadSounds(): Promise<unknown> {
  return Promise.all(Object.entries(SOUNDS).filter(([k]) => !k.startsWith('bgm')).map(([, f]) => buffer(f)));
}

/** Online host: sees every sound the simulation plays so the guests can play it too. */
export let soundTap: ((key: string, volume: number) => void) | null = null;
export function setSoundTap(f: ((key: string, volume: number) => void) | null): void { soundTap = f; }

export function playSound(key: string, volume = 1): void {
  soundTap?.(key, volume);
  if (!soundOn) return;
  const f = SOUNDS[key];
  if (!f) return;
  void buffer(f).then((b) => {
    if (!b) return;
    const s = ac().createBufferSource();
    s.buffer = b;
    let out: AudioNode = fxGain;
    if (volume !== 1) {
      const g = ac().createGain();
      g.gain.value = volume;
      g.connect(fxGain);
      out = g;
    }
    s.connect(out);
    s.start();
  });
}

let wanted = '';
export function playMusic(key: string): void {
  if (wanted === key && music) return;
  stopMusic();
  wanted = key;
  const f = SOUNDS[key];
  if (!musicOn || !f) return;
  void buffer(f).then((b) => {
    if (!b || wanted !== key || music) return;
    const s = ac().createBufferSource();
    s.buffer = b;
    s.loop = true;
    s.connect(musicGain);
    s.start();
    music = { src: s, name: key };
  });
}

export function stopMusic(): void {
  wanted = '';
  if (music) {
    try { music.src.stop(); } catch { /* already stopped */ }
    music = null;
  }
}

export function setSoundEnabled(on: boolean): void { soundOn = on; }
export function setMusicEnabled(on: boolean): void { musicOn = on; if (!on) stopMusic(); }
