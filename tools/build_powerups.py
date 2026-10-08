"""Power-up sprites in the game's 8-bit look, from the SVG sources in tools/powerups (and tools/star-source.svg).

Same "shader" as the ninja star (tools/build_star.py): the vector shape is rasterised, thresholded to a hard 1-bit mask at the target size and
painted with a tiny fixed palette (dark outline + 3 tones, light from the top-left). No anti-aliasing, no gradients. Inside an SVG, white
(#ffffff) paints the highlight tone and red (#ff0000) the dark outline tone, so a shape can carry small details (the shield's cross...).

Types (anim ids): 1 star (gold, spins), 2 heart (red), 3 bolt (cyan), 4 shield (green), 5 fist (orange), 6 fang (purple).
Each has 4 frames: the star turns 18 degrees per frame, the others get a glint that sweeps across them. Row 6 holds 12x12 icons for the HUD
(anims 11..16).

  public/assets/bonus/powerups.png    sheet: 6 rows of 4 frames of 22x22, then the 12x12 icons
  src/svnz/data/powerups.json         character-like data ('PowerUps') for the engine's sprite loader

usage: python tools/build_powerups.py
"""
import json
import os

import fitz
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'tools', 'powerups')
OUT_PNG = os.path.join(ROOT, 'public', 'assets', 'bonus', 'powerups.png')
OUT_JSON = os.path.join(ROOT, 'src', 'svnz', 'data', 'powerups.json')

# (name, svg, palette, fill holes, rotates)
TYPES = [
    ('star', os.path.join(ROOT, 'tools', 'star-source.svg'), {'out': (48, 24, 8), 'hi': (255, 246, 160), 'base': (248, 192, 40), 'low': (176, 96, 16)}, False, True),
    ('heart', os.path.join(SRC, 'heart-source.svg'), {'out': (56, 8, 32), 'hi': (255, 176, 196), 'base': (232, 48, 84), 'low': (140, 16, 52)}, True, False),
    ('bolt', os.path.join(SRC, 'bolt-source.svg'), {'out': (8, 28, 64), 'hi': (208, 250, 255), 'base': (72, 204, 248), 'low': (24, 100, 188)}, True, False),
    ('shield', os.path.join(SRC, 'shield-source.svg'), {'out': (8, 44, 28), 'hi': (196, 255, 208), 'base': (64, 200, 100), 'low': (24, 120, 60)}, False, False),
    ('fist', os.path.join(SRC, 'fist-source.svg'), {'out': (64, 20, 8), 'hi': (255, 208, 136), 'base': (242, 116, 32), 'low': (160, 48, 8)}, False, False),
    ('fang', os.path.join(SRC, 'fang-source.svg'), {'out': (36, 8, 56), 'hi': (234, 196, 255), 'base': (164, 84, 228), 'low': (92, 36, 148)}, False, False),
]
FRAMES = 4
BIG, SMALL = 22, 12


def render(svg, angle, size):
    """RGBA float image (size*8)^2 of the SVG rotated `angle` degrees, centred."""
    k = 8
    page = fitz.open(svg)[0]
    s = size * k / page.rect.width * 0.94
    pix = page.get_pixmap(matrix=fitz.Matrix(s, s).prerotate(angle), alpha=True)
    im = Image.frombytes('RGBA', (pix.width, pix.height), pix.samples)
    canvas = Image.new('RGBA', (size * k, size * k), (0, 0, 0, 0))
    canvas.alpha_composite(im, ((size * k - im.width) // 2, (size * k - im.height) // 2))
    return np.array(canvas).astype(float) / 255, k


def fill_holes(mk):
    """Everything not reachable from the border is inside the shape (outline-only SVGs become solid)."""
    h, w = mk.shape
    outside = np.zeros_like(mk)
    stack = [(y, x) for y in range(h) for x in (0, w - 1)] + [(y, x) for x in range(w) for y in (0, h - 1)]
    while stack:
        y, x = stack.pop()
        if y < 0 or x < 0 or y >= h or x >= w or outside[y, x] or mk[y, x]:
            continue
        outside[y, x] = True
        stack += [(y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)]
    return ~outside


def masks(svg, angle, size, holes):
    """(silhouette, white detail, red detail) as boolean size x size arrays."""
    rgba, k = render(svg, angle, size)
    a = rgba[:, :, 3].reshape(size, k, size, k).mean(axis=(1, 3))
    mk = a > 0.2
    p = np.pad(mk, 1)
    mk = mk | p[:-2, 1:-1] | p[2:, 1:-1] | p[1:-1, :-2] | p[1:-1, 2:]   # fatten by one pixel (thin parts would be all outline)
    if holes:
        mk = fill_holes(mk)
    rgb = rgba[:, :, :3]
    cover = (rgba[:, :, 3] > 0.5)
    white = (rgb.min(axis=2) > 0.85) & cover
    red = (rgb[:, :, 0] > 0.7) & (rgb[:, :, 1] < 0.3) & (rgb[:, :, 2] < 0.3) & cover
    frac = lambda m: m.astype(float).reshape(size, k, size, k).mean(axis=(1, 3)) > 0.5
    return mk, frac(white) & mk, frac(red) & mk


def shade(mk, white, red, pal, glint=-1):
    h, w = mk.shape
    out = np.zeros((h, w, 4), dtype=np.uint8)
    pad = np.pad(mk, 1)
    for y in range(h):
        for x in range(w):
            if not mk[y, x]:
                continue
            n = [pad[y, x + 1], pad[y + 2, x + 1], pad[y + 1, x], pad[y + 1, x + 2]]   # up, down, left, right
            if not all(n):
                col = pal['out']
            elif not pad[y, x] or not pad[y + 1, x]:                                   # up-left diagonal edge
                col = pal['hi']
            else:
                col = pal['base']
            out[y, x] = (*col, 255)
    res = out.copy()
    for y in range(h):
        for x in range(w):
            if out[y, x, 3] == 0 or tuple(out[y, x, :3]) == pal['out']:
                continue
            below = y + 1 < h and tuple(out[y + 1, x, :3]) == pal['out']
            right = x + 1 < w and tuple(out[y, x + 1, :3]) == pal['out']
            above = y > 0 and tuple(out[y - 1, x, :3]) == pal['out']
            left = x > 0 and tuple(out[y, x - 1, :3]) == pal['out']
            if below or right:
                res[y, x] = (*pal['low'], 255)
            elif above or left:
                res[y, x] = (*pal['hi'], 255)
    for y in range(h):
        for x in range(w):
            if not mk[y, x] or tuple(res[y, x, :3]) == pal['out']:
                continue
            if red[y, x]:
                res[y, x] = (*pal['out'], 255)
            elif white[y, x]:
                res[y, x] = (*pal['hi'], 255)
    if glint >= 0:   # a diagonal band of highlight sweeping over the body
        for y in range(h):
            for x in range(w):
                if mk[y, x] and tuple(res[y, x, :3]) == pal['base'] and abs((x + y) - (3 + glint * 10)) <= 0:
                    res[y, x] = (*pal['hi'], 255)
    return res


def main():
    os.makedirs(os.path.dirname(OUT_PNG), exist_ok=True)
    rows = len(TYPES)
    sheet = Image.new('RGBA', (FRAMES * BIG, rows * BIG + SMALL), (0, 0, 0, 0))
    images, anims = {}, {}
    for r, (name, svg, pal, holes, spins) in enumerate(TYPES):
        frames = []
        for f in range(FRAMES):
            m, wh, rd = masks(svg, f * 18 if spins else 0, BIG, holes)
            sheet.paste(Image.fromarray(shade(m, wh, rd, pal, -1 if spins else f)), (f * BIG, r * BIG))
            key = 'p%d_%d' % (r + 1, f)
            images[key] = [f * BIG, r * BIG, BIG, BIG, BIG // 2, BIG // 2]
            frames.append({'img': key, 'ox': 0, 'oy': 0, 't': 5, 'flip': 'NONE', 'body': [], 'hit': []})
        anims[str(r + 1)] = {'loop': 0, 'frames': frames}
        m, wh, rd = masks(svg, 0, SMALL, holes)
        sheet.paste(Image.fromarray(shade(m, wh, rd, pal)), (r * SMALL, rows * BIG))
        key = 'i%d' % (r + 1)
        images[key] = [r * SMALL, rows * BIG, SMALL, SMALL, SMALL // 2, SMALL // 2]
        anims[str(r + 11)] = {'loop': 0, 'frames': [{'img': key, 'ox': 0, 'oy': 0, 't': 60, 'flip': 'NONE', 'body': [], 'hit': []}]}
    sheet.save(OUT_PNG)
    json.dump({'PowerUps': {'sheets': ['assets/bonus/powerups.png'], 'images': images, 'anims': anims}}, open(OUT_JSON, 'w'), separators=(',', ':'))
    os.makedirs(os.path.join(ROOT, 'research', 'shots'), exist_ok=True)
    big = sheet.resize((sheet.width * 6, sheet.height * 6), Image.NEAREST)
    bg = Image.new('RGBA', big.size, (70, 70, 110, 255))
    bg.alpha_composite(big)
    bg.save(os.path.join(ROOT, 'research', 'shots', 'powerups_preview.png'))
    print('ok', sheet.size)


if __name__ == '__main__':
    main()
