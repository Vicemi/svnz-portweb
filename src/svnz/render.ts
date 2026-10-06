// Drawing: FighterFactory sprites, general sparks, bitmap fonts (VampGameFontManager) and the fight HUD.
import { img, preloadImages } from './core/assets';
import { CHARS, type Fighter } from './fight/fighter';
import type { Fight } from './fight/fight';
import type { Frame } from './fight/types';

export const W = 480;
export const H = 272;

/** FightCamera layer translation: world (x, z/2 - y) -> screen. Measured on the original: feet at z=60 -> y 192. */
export const CAM_Y = 162;

export const FONT = {
  small: { path: 'assets/lang/images/fonts/smallFont.png', cw: 8, ch: 8 },
  medium: { path: 'assets/lang/images/fonts/mediumFont.png', cw: 8, ch: 16 },
  debug: { path: 'assets/lang/images/fonts/debugFont.png', cw: 4, ch: 8 },
  smallOn: { path: 'assets/lang/images/fonts/smallFontEnabled.png', cw: 8, ch: 8 },
  smallOff: { path: 'assets/lang/images/fonts/smallFontDisabled.png', cw: 8, ch: 8 },
} as const;
export type FontName = keyof typeof FONT;

export async function preloadGraphics(): Promise<void> {
  const list = new Set<string>();
  for (const c of Object.values(CHARS)) c.sheets.forEach((s) => list.add(s));
  for (const f of Object.values(FONT)) list.add(f.path);
  [
    'assets/images/bg/dojo.png', 'assets/images/bg/arena.png', 'assets/images/bg/practice.png', 'assets/images/bg/trainingBg.png',
    'assets/images/hud/bars.png', 'assets/images/hud/barsEffect.png', 'assets/images/hud/fullBars.png', 'assets/images/hud/comboBars.png',
    'assets/images/hud/menu/selector.png', 'assets/images/misc/batoviScreen.png', 'assets/images/misc/mainScreen.png',
    'assets/images/misc/fightbanner.png', 'assets/images/misc/transitionFight.png', 'assets/images/misc/4x4.png',
    'assets/lang/images/help/help.png',
  ].forEach((p) => list.add(p));
  await preloadImages(list);
}

export function textWidth(font: FontName, s: string): number { return s.length * FONT[font].cw; }

export function drawText(g: CanvasRenderingContext2D, font: FontName, s: string, x: number, y: number, align: 'left' | 'center' | 'right' = 'left'): void {
  const f = FONT[font];
  const im = img(f.path);
  if (!im) return;
  let cx = Math.round(align === 'center' ? x - textWidth(font, s) / 2 : align === 'right' ? x - textWidth(font, s) : x);
  const per = Math.floor(im.width / f.cw);
  for (const ch of s) {
    const c = ch.charCodeAt(0) - 33; // the sheets start at '!' (space is just an advance)
    if (c >= 0 && c < 94) {
      const sx = (c % per) * f.cw, sy = Math.floor(c / per) * f.ch;
      g.drawImage(im, sx, sy, f.cw, f.ch, cx, Math.round(y), f.cw, f.ch);
    }
    cx += f.cw;
  }
}

/** Draw one FighterFactory frame with its axis at screen (sx, sy). */
export function drawFrame(g: CanvasRenderingContext2D, char: string, sheet: number, fr: Frame, sx: number, sy: number, facing: number, alpha = 1): void {
  const cs = CHARS[char];
  const im = img(cs.sheets[sheet] ?? cs.sheets[0]);
  const r = cs.images[fr.img];
  if (!im || !r) return;
  const [x, y, w, h, ax, ay] = r;
  const flip = (facing < 0) !== (fr.flip === 'H');
  g.save();
  if (alpha !== 1) g.globalAlpha = alpha;
  g.translate(Math.round(sx + facing * fr.ox), Math.round(sy + fr.oy));
  if (flip) g.scale(-1, 1);
  g.drawImage(im, x, y, w, h, -ax, -ay, w, h);
  g.restore();
}

export function screenOf(x: number, y: number, z: number): [number, number] {
  return [Math.floor(x + 0.5), Math.floor(z * 0.5 - y + 0.5) + CAM_Y];
}

const BG: Record<string, string> = {
  dojo: 'assets/images/bg/dojo.png', arena: 'assets/images/bg/arena.png', practice: 'assets/images/bg/practice.png',
  dungeon: 'assets/images/bg/trainingBg.png',
};

export function drawFight(g: CanvasRenderingContext2D, fight: Fight, debug = false): void {
  const bg = img(BG[fight.level.bg] ?? BG.dojo);
  let ox = 0, oy = 0;
  if (fight.shake.t > 0) { ox = (Math.random() * 2 - 1) * fight.shake.amp; oy = (Math.random() * 2 - 1) * fight.shake.amp; }
  g.save();
  g.translate(Math.round(ox), Math.round(oy));
  if (bg) g.drawImage(bg, 0, 0);
  type D = { z: number; draw: () => void };
  const items: D[] = [];
  for (const c of fight.clones) {
    const [sx, sy] = screenOf(c.x, c.y, c.z);
    const fr = { img: c.img, ox: c.ox, oy: c.oy, flip: c.flip } as Frame;
    items.push({ z: c.z, draw: () => drawFrame(g, c.char, c.sheet, fr, sx, sy, c.facing, Math.max(0, c.life / c.max) * 0.6) });
  }
  for (const f of fight.fighters) {
    if (f.dead || !f.frame) continue;
    items.push({ z: f.pos.z, draw: () => drawFighter(g, f, debug) });
  }
  for (const s of fight.sparks) {
    const [sx, sy] = screenOf(s.x, s.y, s.z);
    items.push({ z: s.z, draw: () => drawFrame(g, 'Effects', 0, s.anim.frames[s.frame], sx, sy, s.facing) });
  }
  items.sort((a, b) => a.z - b.z);
  for (const it of items) it.draw();
  g.restore();
}

function drawFighter(g: CanvasRenderingContext2D, f: Fighter, debug: boolean): void {
  if (f.blink && !f.blinkOn) return;
  let [sx, sy] = screenOf(f.pos.x, f.pos.y, f.pos.z);
  if (f.shake.on) sx += (Math.random() * 2 - 1) * f.shake.amp;
  drawFrame(g, f.desc.dataKey, f.sheet, f.frame!, sx, sy, f.facing);
  if (debug) {
    g.lineWidth = 1;
    for (const [k, col] of [['body', '#0af'], ['hit', '#f00']] as const) {
      g.strokeStyle = col;
      for (const r of f.rects(k)) g.strokeRect(r[0] + 0.5, r[1] + CAM_Y + 0.5, r[2], r[3]);
    }
  }
}

/** LifeBarManager (player 1): bars.png frame at (10,12), fills from fullBars.png, power orbs. */
export function drawHud(g: CanvasRenderingContext2D, fight: Fight): void {
  const bars = img('assets/images/hud/bars.png');
  const full = img('assets/images/hud/fullBars.png');
  const p = fight.players[0];
  if (!bars || !full || !p) return;
  g.drawImage(bars, 0, 0, 168, 12, 10, 12, 168, 12);
  g.drawImage(bars, 8, 12, 88, 20, 18, 24, 88, 20);
  const lw = Math.round(128 * Math.max(0, p.life) / p.lifeMax);
  if (lw > 0) g.drawImage(full, 0, 0, lw, 8, 30, 14, lw, 8);
  const orbs = Math.floor(p.power / 100);
  const pw = orbs >= 3 ? 48 : Math.round(48 * (p.power % 100) / 100);
  if (pw > 0) g.drawImage(full, 0, 8, pw, 8, 38, 26, pw, 8);
  if (orbs > 0) {
    const ow = orbs === 1 ? 8 : orbs === 2 ? 18 : 29;
    const oh = orbs === 1 ? 8 : 10;
    g.drawImage(full, 0, 16, ow, oh, 49, 35, ow, oh);
  }
  drawText(g, 'small', p.name, 32, 4);
  drawText(g, 'medium', 'Press ENTER for Help', 280, 2, 'center');
  drawText(g, 'medium', `Record: ${fight.record}`, 470, 4, 'right');
  drawText(g, 'medium', `Count: ${fight.count}`, 470, 18, 'right');
  if (fight.wave?.mode === 'TimeMode') {
    const t = Math.ceil(fight.timeLeft);
    drawText(g, 'medium', `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`, 240, 34, 'center');
  }
  // enemy life bars (comboBars.png): above each CPU enemy
  const cb = img('assets/images/hud/comboBars.png');
  if (cb) {
    for (const e of fight.fighters) {
      if (e.dead || fight.players.includes(e)) continue;
      const [sx, sy] = screenOf(e.pos.x, e.pos.y, e.pos.z);
      const w = 32, x = sx - w / 2, y = sy - 70;
      g.drawImage(cb, 0, 8, 64, 8, x, y, w, 4);
      const lw2 = Math.round(w * e.life / e.lifeMax);
      if (lw2 > 0) g.drawImage(cb, 0, 0, Math.round(64 * e.life / e.lifeMax), 8, x, y, lw2, 4);
    }
  }
}

export function drawBanner(g: CanvasRenderingContext2D, text: string): void {
  if (!text) return;
  g.fillStyle = 'rgba(0,0,0,0.55)';
  g.fillRect(0, 105, W, 22);
  drawText(g, 'medium', text, W / 2, 108, 'center');
}
