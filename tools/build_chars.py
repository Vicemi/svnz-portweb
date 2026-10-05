"""Convert the FighterFactory character files of Super Vampire Ninja Zero (public/assets/images/characters/*,
copied from the user's install) into src/svnz/data/chars.json, the format the port's sprite engine reads.

FighterFactory format (per character folder):
  <Char>.png / <Char>N.png   sheet and palette variants
  <Char>.xml                 one <frame name="char#G_III.png" x y w h> per image (group G, index I)
  <Char>.fgt                 addImage:G,I,axisX,axisY        image axis (feet point, from the image's top-left)
                             addBlueRect:x1,y1,x2,y2         body box(es) of the next frame (feet-relative,
                                                             x forward, y up negative); several allowed
                             addRedRect:x1,y1,x2,y2          hit box(es) of the next frame
                             addFrame:G,I,offX,offY,ticks,flip
                             addAnim:id,loopStart            -1 = no loop, otherwise frame index to loop from

usage: python tools/build_chars.py
"""
import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHARS = os.path.join(ROOT, 'public', 'assets', 'images', 'characters')
EFFECTS = os.path.join(ROOT, 'public', 'assets', 'images', 'misc', 'effects', 'generalSparks')


def load(folder, stem, rel):
    xml = open(os.path.join(folder, stem + '.xml'), encoding='latin1').read()
    rects = {}
    for m in re.finditer(r'<frame [^>]*name="[^"#]*#(\d+)_(\d+)\.png" w="(\d+)" h="(\d+)" x="(\d+)" y="(\d+)"', xml):
        g, i, w, h, x, y = map(int, m.groups())
        rects['%d_%d' % (g, i)] = [x, y, w, h]
    axes, anims = {}, {}
    frames, blue, red = [], [], []
    for line in open(os.path.join(folder, stem + '.fgt'), encoding='latin1'):
        line = line.strip()
        if not line or line.startswith(';'):
            continue
        cmd, _, args = line.partition(':')
        a = [s.strip() for s in args.split(',')]
        if cmd == 'addImage':
            axes['%s_%s' % (a[0], a[1])] = [float(a[2]), float(a[3])]
        elif cmd == 'addBlueRect':
            blue.append([int(v) for v in a[:4]])
        elif cmd == 'addRedRect':
            red.append([int(v) for v in a[:4]])
        elif cmd == 'addFrame':
            frames.append({'img': '%s_%s' % (a[0], a[1]), 'ox': int(a[2]), 'oy': int(a[3]), 't': int(a[4]),
                           'flip': a[5] if len(a) > 5 else 'NONE', 'body': blue, 'hit': red})
            blue, red = [], []
        elif cmd == 'addAnim':
            anims[a[0]] = {'loop': int(a[1]), 'frames': frames}
            frames = []
    sheets = sorted(f for f in os.listdir(folder) if re.fullmatch(re.escape(stem) + r'\d*\.png', f))
    return {'sheets': [rel + '/' + s for s in sheets], 'images': {k: rects[k] + axes.get(k, [0, 0])
                                                                    for k in rects}, 'anims': anims}


def main():
    out = {}
    for d in sorted(os.listdir(CHARS)):
        folder = os.path.join(CHARS, d)
        if not os.path.isdir(folder):
            continue
        stem = next(f[:-4] for f in os.listdir(folder) if f.endswith('.fgt'))
        out[stem] = load(folder, stem, 'assets/images/characters/' + d)
    out['Effects'] = load(EFFECTS, 'Effects', 'assets/images/misc/effects/generalSparks')
    os.makedirs(os.path.join(ROOT, 'src', 'svnz', 'data'), exist_ok=True)
    json.dump(out, open(os.path.join(ROOT, 'src', 'svnz', 'data', 'chars.json'), 'w'), separators=(',', ':'))
    for k, v in out.items():
        print(k, 'sheets', len(v['sheets']), 'images', len(v['images']), 'anims', len(v['anims']))


if __name__ == '__main__':
    main()
