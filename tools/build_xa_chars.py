"""Build src/svnz/data/xa.json: the XA characters (boss and hero) and effects in the same FighterFactory-like shape
as chars.json, converted from the XA port's sprite tables (XA-PortWeb/src/xa/data/sprites.json).

  image id  "G_I"  = map group G, cell I        value [x, y, w, h, axisX, axisY]
  anim id   numeric (SVNZ states address animations by number, see src/svnz/bonus/data.ts)
  frame ticks = d * 60 / base ; loop: XA "loop 1" -> frame 0, otherwise -1

usage: python tools/build_xa_chars.py [path to XA-PortWeb]
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
XA = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(ROOT), 'XA-PortWeb')
SP = json.load(open(os.path.join(XA, 'src', 'xa', 'data', 'sprites.json')))
MAPS, ANIMS = SP['maps'], SP['anims']

SHEET = {
    'assets/images/enemies/jefe_tile.png': 'assets/xa/images/jefe_tile.png',
    'assets/images/hero/Xa_animaciones.png': 'assets/xa/images/Xa_animaciones.png',
    'assets/images/elements/planilla_blasts_xa_512x512_24bits.png': 'assets/xa/images/planilla_blasts_xa_512x512_24bits.png',
}


def cell(m, i):
    x, y, w, h = m['rect']
    ax, ay = m['anchor']
    t = m['type']
    if t == 3:
        return [x, y, w, h, ax, ay]
    cols = m['cols']
    return [x + (i % cols) * w, y + (i // cols) * h, w, h, ax, ay]


# muzzle of the cannon / gun per picture (XA px from the anchor, measured on the sheets: research/muzzle.py)
MUZZLE = {
    ('HERO', 19): (26, -17), ('HERO', 20): (23, -17), ('HERO', 28): (21, -26),
    ('HERO', 29): (27, -17), ('HERO', 30): (27, -18), ('HERO', 31): (28, -15), ('HERO', 32): (26, -14), ('HERO', 33): (28, -16),
    ('HERO', 34): (27, -17), ('HERO', 35): (27, -20), ('HERO', 36): (26, -18), ('HERO', 37): (27, -15),
    ('BOSS', 3): (36, -66), ('BOSS', 4): (36, -66),
}


def build(name, scale, maps, anims, body, hit_rule=None):
    sheets = sorted({SHEET[MAPS[m]['path']] for m in maps})
    images, out = {}, {}
    for aid, (src, loop_override) in anims.items():
        a = ANIMS[src] if isinstance(src, str) else src
        frames = []
        for f in a['frames']:
            key = '%s_%d' % (f['map'], f['i'])
            if key not in images:
                c = cell(MAPS[f['map']], f['i'])
                images[key] = c
            ticks = max(1, round(f['d'] * 60 / a['base']))
            fr = {'img': key, 'ox': 0, 'oy': f.get('oy', 0), 't': ticks, 'flip': 'NONE',
                  'body': [body], 'hit': []}
            if hit_rule and hit_rule(aid):
                fr['hit'] = [body]
            if (f['map'], f['i']) in MUZZLE:
                fr['mz'] = list(MUZZLE[(f['map'], f['i'])])
            frames.append(fr)
        out[str(aid)] = {'loop': (0 if a['loop'] else -1) if loop_override is None else loop_override, 'frames': frames}
    s = {'sheets': [sheets[0]] if len(sheets) == 1 else sheets, 'images': images, 'anims': out, 'scale': scale}
    # all maps of one character live on one sheet here
    return s


def scaled(c, k):
    """Pre-scale rects and axes so the engine needs no scaling for hit boxes (the renderer scales the picture)."""
    for fr in [f for a in c['anims'].values() for f in a['frames']]:
        fr['body'] = [[round(v * k) for v in r] for r in fr['body']]
        fr['hit'] = [[round(v * k) for v in r] for r in fr['hit']]
        fr['oy'] = round(fr['oy'] * k)
        if 'mz' in fr:
            fr['mz'] = [round(v * k) for v in fr['mz']]
    return c


def main():
    hero_frames = lambda i: {'map': 'HERO', 'i': i, 'd': 1}
    one = lambda frames, loop, base=60: {'loop': loop, 'base': base, 'frames': frames}
    flinch = one([{'map': 'HERO', 'i': 26, 'd': 20}], 0)
    lie = one([{'map': 'HERO', 'i': 27, 'd': 30}], 0)
    hero_anims = {
        0: ('STAND', None), 10: ('WALK', None), 20: ('JUMP', None), 30: ('SHOT_STAND', -1),
        40: ('SHOT_RUN', None), 50: ('BLOCK_IN', None), 60: ('BLOCK_OUT', None),
        5000: (flinch, None), 5010: (flinch, None), 5015: (flinch, None), 5020: (flinch, None), 5030: (flinch, None),
        5040: (flinch, None), 5050: (flinch, None), 5055: (flinch, None), 5060: (flinch, None), 5070: (flinch, None),
        5100: (flinch, None), 5110: (lie, None), 5120: (lie, None), 5130: (lie, None), 5140: (lie, None),
        5150: (lie, None), 5160: ('GET_UP', None), 5200: (one([{'map': 'HERO', 'i': 0, 'd': 6}], 0), None),
        5210: (one([{'map': 'HERO', 'i': 0, 'd': 6}], 0), None), 5500: (lie, None), 5510: (lie, None),
    }
    hero = build('XaHero', 1.0, ['HERO'], hero_anims, [-12, -45, 12, 0])

    dead = ANIMS['BOSS_DEAD']
    boss_anims = {
        0: (one([{'map': 'BOSS', 'i': 0, 'd': 4}], 0, 30), None), 10: ('BOSS', None), 20: ('BOSS_SHOOT', None),
        5500: ({'loop': 0, 'base': dead['base'], 'frames': [dict(f, oy=-86) for f in dead['frames']]}, None),
    }
    # no contact damage (the SVNZ fighter is mostly melee: touching the boss must not hurt)
    boss = build('XaBoss', 0.62, ['BOSS', 'BOSS_DEAD'], boss_anims, [-56, -172, 56, 0])
    # the boss and its explosion share jefe_tile.png; BOSS_DEAD frames use their own anchor
    fx_maps = {'BLAST_ENEMY': {'path': 'assets/images/elements/planilla_blasts_xa_512x512_24bits.png', 'type': 3, 'anchor': [30, 33], 'rect': [420, 0, 60, 60]},
               'BLAST_HERO': {'path': 'assets/images/elements/planilla_blasts_xa_512x512_24bits.png', 'type': 3, 'anchor': [30, 33], 'rect': [420, 60, 60, 60]}}
    for k, v in fx_maps.items():
        MAPS[k] = v
    fx_anims = {
        1: ({'loop': 1, 'base': 60, 'frames': [{'map': 'BLAST_ENEMY', 'i': 0, 'd': 6}]}, None),
        2: ({'loop': 1, 'base': 60, 'frames': [{'map': 'BLAST_HERO', 'i': 0, 'd': 6}]}, None),
        10: ('HERO_DEATH', None), 20: ('SHIELD', None), 21: ('SHIELD_GREEN', None),
    }
    fx = build('XaFx', 1.0, ['BLAST_ENEMY', 'BLAST_HERO', 'HERO_DEATH', 'SHIELD'], fx_anims, [-8, -8, 8, 8])
    for f in [fr for a in fx['anims'].values() for fr in a['frames']]:
        f['body'] = []
    out = {'XaHero': scaled(hero, 1.0), 'XaBoss': scaled(boss, 0.62), 'XaFx': fx}
    # scaled pictures: scale the axes' effect through the renderer (scale field); frames' oy already scaled
    path = os.path.join(ROOT, 'src', 'svnz', 'data', 'xa.json')
    json.dump(out, open(path, 'w'), separators=(',', ':'))
    for k, v in out.items():
        print(k, 'sheets', v['sheets'], 'images', len(v['images']), 'anims', sorted(map(int, v['anims'])))


if __name__ == '__main__':
    main()
