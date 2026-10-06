"""Build src/svnz/data/fsm.json from research/decoded.json (the symbolic decode of svnz.exe's builder functions,
see research/decode_builders.py and MODLOG round 1).

Output:
  states:   name -> {anim, move, walkAnim, f48, f4c, faceStick, control, type, phys, entry:[act], triggers:[trig]}
  dicts:    dictName -> {base, map: generic -> specific}
  controls: package -> [{state, conds:[cond]}]
  hits:     name -> {field: value}  (inherits resolved)
  act  = {a: actionName, p: params}      cond = {c: condName, want: bool, p: params} | {and|or: [cond]}
  params = {i: [int], f: [float], s: [str], b: [bool]}
"""
import copy
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEC = json.load(open(os.path.join(ROOT, 'research', 'decoded.json')))

STATE_DEFAULT = {'anim': 0, 'move': False, 'walkAnim': -1, 'f48': 0.0, 'f4c': 0.0, 'faceStick': False,
                 'control': None, 'type': 4, 'phys': 2, 'entry': [], 'triggers': []}
FIELD = {'0x3c': 'anim', '0x40': 'move', '0x44': 'walkAnim', '0x48': 'f48', '0x4c': 'f4c', '0x50': 'faceStick',
         '0x74': 'type', '0x78': 'phys'}
HITF = {'0x0': 'vx', '0x4': 'vy', '0x8': 'vz', '0xc': 'avx', '0x10': 'avy', '0x14': 'avz', '0x20': 'damage',
        '0x24': 'pauseA', '0x28': 'pauseV', '0x2c': 'affect', '0x30': 'b30', '0x31': 'b31', '0x34': 'fallType',
        '0x38': 'damageType', '0x3c': 'aimType', '0x40': 'sound', '0x5c': 'spark', '0x78': 'target',
        '0x7c': 'priority', '0x94': 'powerV', '0x98': 'powerA'}


def signed(v):
    if isinstance(v, int) and v >= 0x80000000:
        return v - 0x100000000
    return v


def fsm(events, states):
    cur = None
    trig = None
    params = None
    stack = []

    def take():
        nonlocal params
        p = params or {}
        params = None
        return {k: v for k, v in p.items() if v}

    def addp(kind, *vals):
        nonlocal params
        if params is None:
            params = {'i': [], 'f': [], 's': [], 'b': []}
        params[kind].extend(vals)

    for e in events:
        op = e[0]
        if op in ('newState', 'newStateFrom'):
            cur = copy.deepcopy(STATE_DEFAULT)
            if op == 'newStateFrom':
                base = states[e[2]]
                for k in ('anim', 'move', 'walkAnim', 'f48', 'faceStick', 'control', 'type', 'phys'):
                    cur[k] = base[k]
                cur['triggers'] = copy.deepcopy(base['triggers'])
                cur['entry'] = copy.deepcopy(base['entry'])
            states[e[1]] = cur
            trig = None
            params = None
        elif op == 'field' and e[1] == 'STATE':
            k = FIELD.get(e[2])
            v = signed(e[4])
            if k in ('move', 'faceStick'):
                v = bool(v)
            if k:
                cur[k] = v
            else:
                cur['x' + e[2]] = v
        elif op == 'field' and e[1] == 'TRIG' and e[2] == '0x3c':
            trig['persist'] = bool(e[4])
        elif op == 'trigger':
            trig = {'persist': False, 'conds': [], 'acts': []}
            cur['triggers'].append(trig)
        elif op == 'controlState':
            cur['control'] = e[1]
        elif op == 'int':
            addp('i', signed(e[1]))
        elif op == 'int2':
            addp('i', signed(e[1]), signed(e[2]))
        elif op == 'int3':
            addp('i', signed(e[1]), signed(e[2]), signed(e[3]))
        elif op == 'float':
            addp('f', e[1])
        elif op == 'float2':
            addp('f', e[1], e[2])
        elif op == 'float3':
            addp('f', e[1], e[2], e[3])
        elif op == 'str':
            addp('s', e[1])
        elif op == 'bool':
            addp('b', bool(e[1]))
        elif op == 'beginOr':
            stack.append({'or': []})
        elif op == 'beginAnd':
            stack.append({'and': []})
        elif op == 'endCompound':
            c = stack.pop()
            take()
            (stack[-1].get('or', stack[-1].get('and')) if stack else trig['conds']).append(c)
        elif op == 'cond':
            c = {'c': e[1], 'want': bool(e[2])}
            p = take()
            if p:
                c['p'] = p
            if stack:
                stack[-1].get('or', stack[-1].get('and')).append(c)
            else:
                trig['conds'].append(c)
        elif op == 'action':
            a = {'a': e[1]}
            p = take()
            if p:
                a['p'] = p
            (trig['acts'] if trig else cur['entry']).append(a)
    return states


def controls(events):
    out = {}
    pkg = None
    cur = None
    params = None
    for e in events:
        op = e[0]
        if op == 'controlPackage':
            pkg = out.setdefault(e[1], [])
        elif op == 'controlTrigger':
            cur = {'state': e[1], 'conds': []}
            pkg.append(cur)
            params = None
        elif op in ('int', 'str'):
            params = params or {'i': [], 's': []}
            params['i' if op == 'int' else 's'].append(signed(e[1]) if op == 'int' else e[1])
        elif op == 'cond':
            c = {'c': e[1], 'want': bool(e[2])}
            if params:
                c['p'] = {k: v for k, v in params.items() if v}
            params = None
            cur['conds'].append(c)
    return out


def dicts(events):
    out = {}
    cur = None
    for e in events:
        if e[0] == 'newDict':
            cur = out.setdefault(e[1], {'base': None, 'map': {}})
        elif e[0] == 'newDictFrom':
            base = out[e[2]]
            cur = out.setdefault(e[1], {'base': e[2], 'map': dict(base['map'])})
        elif e[0] == 'map':
            cur['map'][e[1]] = e[2]
    return out


def hits(events):
    out = {}
    cur = None
    for e in events:
        if e[0] == 'newHit':
            cur = out.setdefault(e[1], {})
        elif e[0] == 'newHitFrom':
            cur = out[e[1]] = dict(out[e[2]])
        elif e[0] == 'field' and e[1] == 'HIT':
            k = HITF.get(e[2], 'x' + e[2])
            v = e[4]
            if e[3] == 'byte':
                v = bool(v)
            elif isinstance(v, int):
                v = signed(v)
            cur[k] = v
    return out


def main():
    states = {}
    for part in ('human', 'mina', 'enemies'):
        fsm(DEC[part], states)
    data = {'states': states, 'dicts': dicts(DEC['dicts']), 'controls': controls(DEC['control']),
            'hits': hits(DEC['hits'])}
    out = os.path.join(ROOT, 'src', 'svnz', 'data', 'fsm.json')
    json.dump(data, open(out, 'w'), separators=(',', ':'))
    print('states', len(states), 'dicts', {k: len(v['map']) for k, v in data['dicts'].items()},
          'controls', {k: len(v) for k, v in data['controls'].items()}, 'hits', len(data['hits']))


if __name__ == '__main__':
    main()
