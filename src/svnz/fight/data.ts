// characters.xml / waves.xml / menu.xml readers (FighterLoader 0041baa0, WavesManager).
import { loadText } from '../core/assets';
import type { CharDesc } from './types';

const DEFAULTS: Record<string, number> = { friction: 1200, gravity: -1200, reflexesFrequency: 4, walkSpeed: 0, strength: 1 };

export interface CharEntry { base: CharDesc; names: Partial<Record<string, string>>[]; generic: Partial<Record<string, string>>[] }
export interface FighterSpec { type: string; nameIndex: number; state?: string; yPos?: number; attrs: Record<string, string> }
export interface FighterList { team: number; fighters: FighterSpec[] }
export interface WaveDef { mode: string; list: string; activeEnemies: number; listExtras?: string; activeExtras: number; loopIndex: number; time: number }
export interface LevelWave { name: string; music?: string; initialTextKey: string; startTextKey: string; finalTextKey: string; failTextKey: string }
export interface LevelDef { key: string; name: string; bg: string; music: string; playerTeam: string; waves: LevelWave[] }
export interface MenuOption { textKey: string; action?: string; link?: string }

export const DB = {
  chars: {} as Record<string, CharEntry>,
  levels: {} as Record<string, LevelDef>,
  waves: {} as Record<string, WaveDef>,
  lists: {} as Record<string, FighterList>,
  menus: {} as Record<string, { cancel?: string; options: MenuOption[] }>,
};

function attrs(el: Element): Record<string, string> {
  const o: Record<string, string> = {};
  for (const a of Array.from(el.attributes)) o[a.name] = a.value.trim();
  return o;
}
function parse(text: string): Document {
  return new DOMParser().parseFromString(text, 'application/xml');
}

function toDesc(key: string, a: Record<string, string>, pal: number): CharDesc {
  const num = (k: string, d = 0) => {
    const v = a[k];
    if (v === undefined || v === '' || v === 'DEFAULT') return DEFAULTS[k] ?? d;
    const n = parseFloat(v);
    return Number.isNaN(n) ? DEFAULTS[k] ?? d : n;
  };
  return {
    key,
    alias: a.alias ?? key,
    dataKey: a.dataKey ?? key,
    color: num('color', 0),
    statesDictionary: a.statesDictionary ?? '',
    state: a.state ?? 'Stand',
    controlTriggersHuman: a.controlTriggersHuman ?? '',
    controlTriggersCPU: a.controlTriggersCPU ?? '',
    decisionsAI: a.decisionsAI ?? '',
    reflexesAI: a.reflexesAI ?? '',
    reflexesFrequency: num('reflexesFrequency', 4),
    friction: num('friction'),
    gravity: num('gravity'),
    collisionWidth: num('collisionWidth', 32),
    strength: num('strength', 1),
    armorMode: a.armorMode === 'true',
    lifeHuman: num('lifeHuman', 100),
    lifeCPU: num('lifeCPU', 100),
    closeAttackDist: num('closeAttackDist', 30),
    midAttackDist: num('midAttackDist', 60),
    longAttackDist: num('longAttackDist', 90),
    blendMode: a.blendMode ?? 'DEFAULT',
    tintColor: a.tintColor ?? '',
    walkSpeed: num('walkSpeed'),
    numberOfPalettes: pal,
  };
}

export async function loadData(): Promise<void> {
  const cx = parse(await loadText('assets/data/characters.xml'));
  for (const el of Array.from(cx.documentElement.children)) {
    const def = el.querySelector('defaultValues');
    if (!def) continue;
    const base = toDesc(el.tagName, attrs(def), parseInt(el.getAttribute('numberOfPalettes') ?? '1', 10));
    const names: Partial<Record<string, string>>[] = [];
    const generic: Partial<Record<string, string>>[] = [];
    for (const c of Array.from(el.children)) {
      if (/^name\d+$/.test(c.tagName)) names[parseInt(c.tagName.slice(4), 10)] = attrs(c);
      else if (c.tagName === 'genericName') generic.push(attrs(c));
    }
    DB.chars[el.tagName] = { base, names, generic };
  }
  const wx = parse(await loadText('assets/data/waves.xml'));
  const levels = wx.querySelector('levels');
  for (const el of Array.from(levels?.children ?? [])) {
    const a = attrs(el);
    DB.levels[el.tagName] = {
      key: el.tagName, name: a.name, bg: a.bg, music: a.music, playerTeam: a.playerTeam,
      waves: Array.from(el.children).map((w) => attrs(w) as unknown as LevelWave),
    };
  }
  for (const el of Array.from(wx.querySelector('waveList')?.children ?? [])) {
    const a = attrs(el);
    DB.waves[el.tagName] = {
      mode: a.mode, list: a.list, activeEnemies: parseInt(a.activeEnemies ?? '1', 10), listExtras: a.listExtras,
      activeExtras: parseInt(a.activeExtras ?? '0', 10), loopIndex: parseInt(a.loopIndex ?? '0', 10), time: parseFloat(a.time ?? '0'),
    };
  }
  for (const el of Array.from(wx.querySelector('fighterLists')?.children ?? [])) {
    DB.lists[el.tagName] = {
      team: parseInt(el.getAttribute('team') ?? '2', 10),
      fighters: Array.from(el.children).map((f) => {
        const a = attrs(f);
        return { type: a.type, nameIndex: parseInt(a.nameIndex ?? '0', 10), state: a.state, yPos: a.yPos ? parseFloat(a.yPos) : undefined, attrs: a };
      }),
    };
  }
  const mx = parse(await loadText('assets/data/menu.xml'));
  for (const el of Array.from(mx.querySelector('menuDefinition')?.children ?? [])) {
    DB.menus[el.tagName] = { cancel: el.getAttribute('cancel') ?? undefined, options: Array.from(el.children).map((o) => attrs(o) as unknown as MenuOption) };
  }
}

/** Resolve a fighter of a list: nameIndex -1 = random name, color -1 = random palette; per-entry overrides. */
export function makeDesc(spec: FighterSpec): CharDesc {
  const ce = DB.chars[spec.type];
  let over: Partial<Record<string, string>> = {};
  let idx = spec.nameIndex;
  const pool = ce.names.map((n, i) => ({ n, i })).filter((x) => x.n);
  if (idx === -1) {
    const all = [...pool.map((p) => p.n), ...ce.generic];
    over = all.length ? all[Math.floor(Math.random() * all.length)]! : {};
  } else if (idx > 0) {
    over = ce.names[idx] ?? {};
  }
  const merged: Record<string, string> = {};
  const b = ce.base as unknown as Record<string, unknown>;
  for (const k of Object.keys(b)) merged[k] = String(b[k]);
  Object.assign(merged, over, spec.attrs);
  delete merged.type;
  const d = toDesc(spec.type, merged, ce.base.numberOfPalettes);
  if (!('walkSpeed' in over) && !('walkSpeed' in spec.attrs)) d.walkSpeed = ce.base.walkSpeed;
  if (d.color === -1) d.color = Math.floor(Math.random() * ce.base.numberOfPalettes);
  return d;
}
