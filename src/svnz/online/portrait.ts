// Little pictures of the characters for the lobby: the first frame of their standing animation, drawn from the game's own sprite sheets.
import { img } from '../core/assets';
import { CHARS, FSM } from '../fight/fighter';
import { makeDesc } from '../fight/data';
import { drawFrame } from '../render';
import { rosterOf } from './roster';

const cache = new Map<string, string>();

/** PNG data URL (128x128, pixelated by the page) of a character; '' while the sheets are not loaded yet. */
export function portrait(charKey: string, palette = -1): string {
  const id = `${charKey}:${palette}`;
  const hit = cache.get(id);
  if (hit) return hit;
  const r = rosterOf(charKey);
  const desc = makeDesc({ type: r.key, nameIndex: 0, attrs: {} });
  const sheetIdx = palette >= 0 ? palette % Math.max(1, desc.numberOfPalettes) : Math.max(0, desc.color);
  const cs = CHARS[desc.dataKey];
  if (!cs || !img(cs.sheets[Math.min(sheetIdx, cs.sheets.length - 1)] ?? cs.sheets[0])) return '';
  const spec = FSM.dicts[desc.statesDictionary]?.map[r.state === 'Fly' ? 'Fly' : desc.state] ?? '';
  let anim = FSM.states[spec]?.anim ?? -1;
  if (anim < 0 || !cs.anims[String(anim)]) anim = Number(Object.keys(cs.anims)[0] ?? 0);
  const frame = cs.anims[String(anim)]?.frames[0];
  if (!frame) return '';
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  g.scale(2, 2);
  drawFrame(g, desc.dataKey, sheetIdx, frame, 32, 58, 1);
  const url = c.toDataURL('image/png');
  cache.set(id, url);
  return url;
}
