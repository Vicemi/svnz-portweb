"""Ninja star (shuriken) sprites in the game's 8-bit look, from tools/star-source.svg (user supplied, SVG Repo).

The vector shape is rasterised, thresholded to a hard 1-bit mask at the target size and shaded with a tiny fixed palette
(dark outline + 3 tones, light from the top-left): no anti-aliasing, no gradients - the same pixel style as the sprites.

  public/assets/bonus/star.png      row 0: thrown star 16x16 (silver), row 1: pick-up 22x22 (gold); 4 spin frames each
  src/svnz/data/star.json           character-like data ('NinjaStar') for the engine's sprite loader

usage: python tools/build_star.py
"""
import json
import os

import fitz
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SVG = os.path.join(ROOT, 'tools', 'star-source.svg')
OUT_PNG = os.path.join(ROOT, 'public', 'assets', 'bonus', 'star.png')
OUT_JSON = os.path.join(ROOT, 'src', 'svnz', 'data', 'star.json')

SILVER = {'out': (20, 16, 32), 'hi': (248, 248, 255), 'base': (196, 202, 220), 'low': (112, 120, 150)}
GOLD = {'out': (48, 24, 8), 'hi': (255, 246, 160), 'base': (248, 192, 40), 'low': (176, 96, 16)}


def mask(angle, size):
    """1-bit mask of the star rotated `angle` degrees, `size` x `size` px (rasterised at 8x then thresholded)."""
    k = 8
    doc = fitz.open(SVG)
    page = doc[0]
    s = size * k / page.rect.width * 0.94
    m = fitz.Matrix(s, s).prerotate(angle)
    pix = page.get_pixmap(matrix=m, alpha=True)
    im = Image.frombytes('RGBA', (pix.width, pix.height), pix.samples)
    canvas = Image.new('RGBA', (size * k, size * k), (0, 0, 0, 0))
    canvas.alpha_composite(im, ((size * k - im.width) // 2, (size * k - im.height) // 2))
    a = np.array(canvas)[:, :, 3].astype(float) / 255
    a = a.reshape(size, k, size, k).mean(axis=(1, 3))
    mk = a > 0.2
    p = np.pad(mk, 1)
    # fatten by one pixel (thin arms would otherwise be all outline at this size)
    return mk | p[:-2, 1:-1] | p[2:, 1:-1] | p[1:-1, :-2] | p[1:-1, 2:]


def shade(mk, pal):
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
    # second pass: inner pixels next to the outline on the lower right get the shadow tone, upper left the highlight
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
    return res


def main():
    os.makedirs(os.path.dirname(OUT_PNG), exist_ok=True)
    sheet = Image.new('RGBA', (88, 38), (0, 0, 0, 0))
    for row, (size, pal, y0) in enumerate([(16, SILVER, 0), (22, GOLD, 16)]):
        for f in range(4):
            sheet.paste(Image.fromarray(shade(mask(f * 18, size), pal)), (f * size if row == 0 else f * 22, y0))
    sheet.save(OUT_PNG)
    images, anims = {}, {}
    for row, (size, y0, t, name) in enumerate([(16, 0, 3, 'thrown'), (22, 16, 4, 'pickup')]):
        frames = []
        for f in range(4):
            key = '%d_%d' % (row, f)
            x0 = f * size
            images[key] = [x0, y0, size, size, size // 2, size // 2]
            frames.append({'img': key, 'ox': 0, 'oy': 0, 't': t, 'flip': 'NONE', 'body': [], 'hit': []})
        anims[str(row + 1)] = {'loop': 0, 'frames': frames}
    json.dump({'NinjaStar': {'sheets': ['assets/bonus/star.png'], 'images': images, 'anims': anims}}, open(OUT_JSON, 'w'), separators=(',', ':'))
    big = sheet.resize((sheet.width * 6, sheet.height * 6), Image.NEAREST)
    bg = Image.new('RGBA', big.size, (70, 70, 110, 255))
    bg.alpha_composite(big)
    bg.save(os.path.join(ROOT, 'research', 'shots', 'star_preview.png'))
    print('ok')


if __name__ == '__main__':
    main()
