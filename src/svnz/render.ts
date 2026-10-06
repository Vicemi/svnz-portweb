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
    'assets/images/hud/menu/selector.png', 'assets/images/misc/batoviScreen.png', 'assets/images/misc/vicemiScreen.png', 'assets/images/misc/mainScreen.png',
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
  const sc = cs.scale ?? 1;
  const flip = (facing < 0) !== (fr.flip === 'H');
  g.save();
  if (alpha !== 1) g.globalAlpha = alpha;
  g.translate(Math.round(sx + facing * fr.ox), Math.round(sy + fr.oy));
  if (flip) g.scale(-1, 1);
  g.drawImage(im, x, y, w, h, -ax * sc, -ay * sc, w * sc, h * sc);
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
    items.push({ z: s.z, draw: () => drawFrame(g, s.char ?? 'Effects', 0, s.anim.frames[s.frame], sx, sy, s.facing) });
  }
  for (const p of fight.projectiles) {
    const [sx, sy] = screenOf(p.x, p.y, p.z);
    const fr = CHARS.XaFx.anims[String(p.anim)]?.frames[0];
    if (fr) items.push({ z: p.z + 0.5, draw: () => drawFrame(g, 'XaFx', 0, fr, sx, sy, p.vx >= 0 ? 1 : -1) });
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

/** DrawableProportionalLifeBar (00435e20/00435ff0/00436260): frame = bars.png columns 0..W+20 + right cap (148..168),
 *  W = min(lifeMax, 128); fill layers of fullBars.png: green 0..128, yellow (y26) for 128..256, cyan (y34) for 256..384. */
function lifeBar(g: CanvasRenderingContext2D, x: number, y: number, life: number, lifeMax: number, proportional: boolean): void {
  const bars = img('assets/images/hud/bars.png');
  const full = img('assets/images/hud/fullBars.png');
  if (!bars || !full) return;
  if (!proportional) {
    g.drawImage(bars, 0, 0, 168, 12, x, y, 168, 12);
    const w = Math.round(128 * Math.max(0, life) / lifeMax);
    if (w > 0) g.drawImage(full, 0, 0, w, 8, x + 20, y + 2, w, 8);
    return;
  }
  const W = Math.min(lifeMax, 128);
  g.drawImage(bars, 0, 0, W + 20, 12, x, y, W + 20, 12);
  g.drawImage(bars, 148, 0, 20, 12, x + W + 20, y, 20, 12);
  const L = Math.max(0, Math.ceil(life));
  const a = Math.min(L, 128), b = Math.max(0, Math.min(L - 128, 128)), c = Math.max(0, Math.min(L - 256, 128));
  if (a > 0) g.drawImage(full, 0, 0, a, 8, x + 20, y + 2, a, 8);
  if (b > 0) g.drawImage(full, 0, 26, b, 8, x + 20, y + 2, b, 8);
  if (c > 0) g.drawImage(full, 0, 34, c, 8, x + 20, y + 2, c, 8);
}

/** LifeBarManager / DrawablePowerBar / DrawableComboBar / TimeCounter: positions measured on the original (480x272). */
export function drawHud(g: CanvasRenderingContext2D, fight: Fight): void {
  const bars = img('assets/images/hud/bars.png');
  const full = img('assets/images/hud/fullBars.png');
  const fx = img('assets/images/hud/barsEffect.png');
  const p = fight.players[0];
  if (!bars || !full || !p) return;
  // player: life frame (10,12), name above it, power frame (18,24) with orbs
  lifeBar(g, 10, 12, p.life, p.lifeMax, false);
  g.drawImage(bars, 8, 12, 88, 20, 18, 24, 88, 20);
  const orbs = Math.floor(p.power / 100);
  const base = orbs >= 3 ? 48 : Math.round(48 * (p.power % 100) / 100);   // 250 -> 2 orbs + half bar (measured)
  if (base > 0) g.drawImage(full, 0, 8, base, 8, 38, 26, base, 8);
  if (orbs > 0) {
    const ow = orbs === 1 ? 8 : orbs === 2 ? 18 : 29;
    const oh = orbs === 1 ? 8 : 10;
    g.drawImage(full, 0, 16, ow, oh, 49, 35, ow, oh);
  }
  if (p.power >= 300 && fx && Math.floor(fight.time * 6) % 2 === 0) g.drawImage(fx, 8, 12, 88, 20, 18, 24, 88, 20);
  drawText(g, 'small', p.name, 32, 4);
  drawText(g, 'small', 'Press ENTER for Help', 200, 6);
  drawText(g, 'smallOn', `Record: ${fight.record}`, 452, 11, 'right');
  drawText(g, 'smallOn', `Count: ${fight.count}`, 452, 24, 'right');
  if (fight.wave?.mode === 'TimeMode') {
    const t = Math.ceil(fight.timeLeft);
    drawText(g, 'smallOn', `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`, 240, 30, 'center');
  }
  // last enemy hit: bottom right, name above its frame
  const e = fight.target;
  if (e && !e.dead) {
    lifeBar(g, 304, 258, e.life, e.lifeMax, true);
    drawText(g, 'small', e.name, 326, 250);
  }
  // combo counter: bottom left
  const cb = img('assets/images/hud/comboBars.png');
  const c = fight.combo;
  if (cb && c.hits > 0) {
    drawText(g, 'smallOn', `${c.hits} Hits`, 42, 244, 'center');
    g.drawImage(cb, 0, 8, 64, 8, 10, 254, 64, 8);
    const w = Math.max(0, Math.round(64 * c.left / c.window));
    if (w > 0) g.drawImage(cb, 0, 0, w, 8, 10, 254, w, 8);
  }
}

/** Banner text of the wave flow ("Are You Ready?"): small font, translucent black band measured on the original. */
export function drawBanner(g: CanvasRenderingContext2D, text: string): void {
  if (!text) return;
  g.fillStyle = 'rgba(0,0,0,0.45)';
  g.fillRect(0, 127, W, 18);
  drawText(g, 'small', text, W / 2, 132, 'center');
}
