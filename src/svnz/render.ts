// Drawing: FighterFactory sprites, general sparks, bitmap fonts (VampGameFontManager) and the fight HUD.
import { img, preloadImages } from './core/assets';
import { CHARS, type Fighter } from './fight/fighter';
import type { Fight } from './fight/fight';
import type { Frame } from './fight/types';
import { SLOT_COLORS } from './online/roster';
import { itemInfo } from './online/items';
import { portrait } from './online/portrait';

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
export function drawFrame(g: CanvasRenderingContext2D, char: string, sheet: number, fr: Frame, sx: number, sy: number, facing: number, alpha = 1, k = 1): void {
  const cs = CHARS[char];
  const im = img(cs.sheets[sheet] ?? cs.sheets[0]);
  const r = cs.images[fr.img];
  if (!im || !r) return;
  const [x, y, w, h, ax, ay] = r;
  const sc = (cs.scale ?? 1) * k;
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
    items.push({ z: f.pos.z, draw: () => drawFighter(g, f, debug, fight) });
  }
  for (const s of fight.sparks) {
    const [sx, sy] = screenOf(s.x, s.y, s.z);
    items.push({ z: s.z, draw: () => drawFrame(g, s.char ?? 'Effects', 0, s.anim.frames[s.frame], sx, sy, s.facing) });
  }
  for (const p of fight.projectiles) {
    const [sx, sy] = screenOf(p.x, p.y, p.z);
    const ch = p.char ?? 'XaFx';
    const an = CHARS[ch].anims[String(p.anim)];
    // the ninja star spins and grows from a small one while it leaves the hand
    const fr = p.char ? an?.frames[Math.floor(p.t * 20) % an.frames.length] : an?.frames[0];
    const k = p.char ? 0.5 + 0.5 * Math.min(1, p.t / 0.15) : 1;
    if (fr) items.push({ z: p.z + 0.5, draw: () => drawFrame(g, ch, 0, fr, sx, sy, p.vx >= 0 ? 1 : -1, 1, k) });
  }
  // power-ups on the map: the icon bobbing over a shadow with a glint sweeping over it; it blinks when about to vanish
  for (const it of fight.items) {
    const info = itemInfo(it.type);
    const an = CHARS.PowerUps.anims[String(info.id)];
    if (!an) continue;
    const fr = an.frames[Math.floor(fight.time * 10) % an.frames.length]!;
    const bob = Math.round(Math.sin(fight.time * 5) * 2);
    const [sx, sy] = screenOf(it.x, 12 + bob, it.z);
    const [shx, shy] = screenOf(it.x, 0, it.z);
    if (it.t > 3 || Math.floor(fight.time * 8) % 2 === 0) {
      items.push({ z: it.z, draw: () => {
        g.fillStyle = 'rgba(0,0,0,0.35)';
        g.fillRect(shx - 6, shy - 1, 12, 3);
        drawFrame(g, 'PowerUps', 0, fr, sx, sy, 1);
      } });
    }
  }
  items.sort((a, b) => a.z - b.z);
  for (const it of items) it.draw();
  g.restore();
}

/** The sheets only have the printable ASCII range: anything else is dropped; long names are cut. */
const plain = (s: string, max: number): string => s.replace(/[^\x21-\x7e ]/g, '').trim().slice(0, max);

/** Small power-up icon (12x12) at (x, y). */
function drawIcon(g: CanvasRenderingContext2D, id: number, x: number, y: number, alpha = 1): void {
  const an = CHARS.PowerUps.anims[String(id + 10)];
  if (an) { g.globalAlpha = alpha; drawFrame(g, 'PowerUps', 0, an.frames[0]!, x + 6, y + 6, 1); g.globalAlpha = 1; }
}

/** The player's picture as an image (cached): the first standing frame of its character. */
const faces = new Map<string, HTMLImageElement>();
function face(char: string, sheet: number): HTMLImageElement | null {
  const id = `${char}:${sheet}`;
  let im = faces.get(id);
  if (!im) {
    const url = portrait(char, sheet);
    if (!url) return null;
    im = new Image();
    im.src = url;
    faces.set(id, im);
  }
  return im.complete && im.naturalWidth ? im : null;
}

/** Above a player's head, from the head up: [arrow] [power-up icons] name (and in co-op a life bar under it, like a nameplate).
 *  The arrow is drawn only for the player whose screen this is, so everybody can find their own character. */
function drawNameplate(g: CanvasRenderingContext2D, f: Fighter, fight: Fight, sx0: number, sy: number): void {
  const sx = Math.max(Math.min(36, W / 2), Math.min(W - 36, sx0));   // keep the plate on the screen
  const nick = plain(f.nick || f.name, 10) || `P${f.slot + 1}`;
  let top = sy - 52;
  const body = f.rects('body');
  if (body.length) top = Math.min(...body.map((r) => r[1] + CAM_Y)) - 2;
  const col = SLOT_COLORS[f.slot % SLOT_COLORS.length]!;
  const buffs: number[] = [];
  if (f.stars > 0) buffs.push(1);
  if (f.buff.speed > 0) buffs.push(3);
  if (f.buff.shield > 0) buffs.push(4);
  if (f.buff.power > 0) buffs.push(5);
  if (f.buff.fang > 0) buffs.push(6);
  const coop = fight.mode === 'coop';
  const mine = f.slot === fight.local.slot;
  const need = (coop ? 6 : 0) + 10 + (buffs.length ? 13 : 0) + (mine ? 9 : 0);
  let y = Math.max(need + 1, top);          // keep it on the screen
  if (coop) {
    const w = 30, x = Math.round(sx - w / 2);
    y -= 6;
    g.fillStyle = '#000';
    g.fillRect(x - 1, y - 1, w + 2, 5);
    const k = Math.max(0, Math.min(1, f.life / Math.max(1, f.lifeMax)));
    g.fillStyle = k > 0.5 ? '#58d858' : k > 0.25 ? '#f8c028' : '#e83838';
    g.fillRect(x, y, Math.round(w * k), 3);
  }
  const w = textWidth('small', nick);
  y -= 10;
  g.fillStyle = 'rgba(0,0,0,0.55)';
  g.fillRect(Math.round(sx - w / 2) - 2, y - 1, w + 4, 10);
  g.fillStyle = col;
  g.fillRect(Math.round(sx - w / 2) - 2, y + 9, w + 4, 1);
  drawText(g, mine ? 'smallOn' : 'small', nick, sx, y, 'center');
  if (buffs.length) {
    y -= 13;
    buffs.forEach((id, i) => drawIcon(g, id, Math.round(sx - (buffs.length * 13 - 1) / 2) + i * 13, y));
  }
  if (mine) {
    y -= 8 - Math.round(Math.sin(fight.time * 6));
    // a small arrow pointing down at the player: dark edge, color of the player
    g.fillStyle = '#000';
    for (let r = 0; r < 5; r++) g.fillRect(Math.round(sx) - 4 + r, y + r, 9 - 2 * r, 1);
    g.fillStyle = col;
    for (let r = 0; r < 4; r++) g.fillRect(Math.round(sx) - 3 + r, y + r, 7 - 2 * r, 1);
  }
}

function drawFighter(g: CanvasRenderingContext2D, f: Fighter, debug: boolean, fight: Fight): void {
  if ((f.blink && !f.blinkOn) || f.hidden) return;
  let [sx, sy] = screenOf(f.pos.x, f.pos.y, f.pos.z);
  if (f.shake.on) sx += (Math.random() * 2 - 1) * f.shake.amp;
  if (f.buff.shield > 0) {   // shield power-up: a translucent bubble around the body
    g.save();
    g.fillStyle = 'rgba(96,230,140,0.22)';
    g.strokeStyle = 'rgba(210,255,225,0.85)';
    g.lineWidth = 1;
    g.beginPath();
    g.ellipse(Math.round(sx), Math.round(sy - 22), 24, 31, 0, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.restore();
  }
  drawFrame(g, f.desc.dataKey, f.sheet, f.frame!, sx, sy, f.facing);
  if (f.slot >= 0 && fight.mode !== 'story') drawNameplate(g, f, fight, sx, sy);
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
  const p = fight.local;
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
  if (p.stars > 0) {
    // ninja-star power-up: icon + remaining time under the power bar
    const an = CHARS.NinjaStar.anims['1'];
    drawFrame(g, 'NinjaStar', 0, an.frames[Math.floor(fight.time * 12) % an.frames.length], 118, 36, 1);
    g.fillStyle = '#140c20';
    g.fillRect(128, 32, 42, 8);
    g.fillStyle = '#f8c028';
    g.fillRect(129, 33, Math.round(40 * Math.min(1, p.stars / 20)), 6);
  }
  drawText(g, 'small', plain(p.name, 16), 32, 4);
  drawText(g, 'small', 'Press ENTER for Help', 200, 6);
  if (fight.mode !== 'vs') {
    drawText(g, 'smallOn', `Record: ${fight.record}`, 452, 11, 'right');
    drawText(g, 'smallOn', `Count: ${fight.count}`, 452, 24, 'right');
  }
  if (fight.mode === 'vs') drawVsBar(g, fight);
  if (fight.wave?.mode === 'TimeMode') {
    const t = Math.ceil(fight.timeLeft);
    drawText(g, 'smallOn', `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`, 240, 30, 'center');
  }
  // last enemy hit: bottom right, name above its frame
  const e = fight.mode === 'vs' ? null : fight.target;
  if (e && !e.dead) {
    lifeBar(g, 304, 258, e.life, e.lifeMax, true);
    drawText(g, 'small', plain(e.name, 20), 326, 250);
  }
  // combo counter: bottom left
  const cb = img('assets/images/hud/comboBars.png');
  const c = fight.combo;
  if (cb && c.hits > 0 && fight.mode !== 'vs') {
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

/** VS, Smash style: along the bottom, one card per player (face, name up to 10 characters, life bar and the lives left as hearts).
 *  Up to 4 players fit side by side. */
function drawVsBar(g: CanvasRenderingContext2D, fight: Fight): void {
  const ps = fight.players;
  const cw = 118, h = 36, gap = 2;
  const total = ps.length * cw + (ps.length - 1) * gap;
  const x0 = Math.round((W - total) / 2);
  const y0 = H - h - 2;
  ps.forEach((f, i) => {
    const x = x0 + i * (cw + gap);
    const col = SLOT_COLORS[f.slot % SLOT_COLORS.length]!;
    const mine = f === fight.local;
    const out = f.out;
    g.fillStyle = out ? 'rgba(20,20,24,0.8)' : 'rgba(10,6,24,0.72)';
    g.fillRect(x, y0, cw, h);
    g.fillStyle = col;
    g.fillRect(x, y0, cw, 2);
    if (mine) { g.strokeStyle = '#fff'; g.lineWidth = 1; g.strokeRect(x + 0.5, y0 + 0.5, cw - 1, h - 1); }
    const im = face(f.desc.key, f.sheet);
    g.globalAlpha = out ? 0.35 : 1;
    if (im) { g.imageSmoothingEnabled = false; g.drawImage(im, 0, 12, 128, 104, x + 3, y0 + 5, 30, 26); }
    g.globalAlpha = 1;
    const nick = plain(f.nick || f.name, 10) || `P${f.slot + 1}`;
    drawText(g, out ? 'smallOff' : mine ? 'smallOn' : 'small', nick, x + 37, y0 + 5);
    // life bar
    const bw = 76, by = y0 + 15;
    g.fillStyle = '#000';
    g.fillRect(x + 36, by - 1, bw + 2, 7);
    g.fillStyle = '#2a2236';
    g.fillRect(x + 37, by, bw, 5);
    const k = out ? 0 : Math.max(0, Math.min(1, f.life / Math.max(1, f.lifeMax)));
    g.fillStyle = k > 0.5 ? '#58d858' : k > 0.25 ? '#f8c028' : '#e83838';
    g.fillRect(x + 37, by, Math.round(bw * k), 5);
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.fillRect(x + 37, by, Math.round(bw * k), 1);
    // lives
    const max = fight.maxStocks || 3;
    for (let l = 0; l < max; l++) drawIcon(g, 2, x + 36 + l * 13, y0 + 22, l < f.stocks ? 1 : 0.22);
    if (out) drawText(g, 'smallOn', 'OUT', x + cw - 4, y0 + 25, 'right');
    else if (f.dead && f.respawn > 0) drawText(g, 'small', '...', x + cw - 4, y0 + 25, 'right');
  });
}
