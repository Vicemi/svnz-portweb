// Which buttons each character uses (decoded from the control triggers: fsm.json controls). The touch controls show only these, labelled with
// what they do for that character; the keys are the usual keyboard ones (the touch buttons send them).

export type TouchKey = 'KeyQ' | 'KeyW' | 'KeyE' | 'KeyA' | 'KeyS' | 'KeyD';
export interface TouchButton { key: TouchKey; label: string }

const ATTACK: TouchButton = { key: 'KeyQ', label: 'Ataque' };

const BY_CHAR: Record<string, TouchButton[]> = {
  Mina: [
    { key: 'KeyQ', label: 'Rápido' }, { key: 'KeyW', label: 'Fuerte' }, { key: 'KeyE', label: 'Salto' },
    { key: 'KeyD', label: 'Dash' }, { key: 'KeyA', label: 'Especial' }, { key: 'KeyS', label: 'Defensa' },
  ],
  GenericNinja: [ATTACK],
  DemonNinja: [ATTACK],
  GoldDemonNinja: [ATTACK],
  Bat: [ATTACK],
  BigDemon: [ATTACK, { key: 'KeyE', label: 'Body slam' }],
  Dracula: [ATTACK, { key: 'KeyW', label: 'Patada' }, { key: 'KeyA', label: 'Veloz' }],
  XaHero: [{ key: 'KeyQ', label: 'Disparo' }, { key: 'KeyE', label: 'Salto' }, { key: 'KeyW', label: 'Escudo' }],
  XaBoss: [{ key: 'KeyQ', label: 'Cañón' }],
};

/** The buttons of a character. With the star power-up, everybody but Mina (who throws with Q / W) gets a "star" button on the special key. */
export function touchButtons(char: string, star = false): TouchButton[] {
  const list = BY_CHAR[char] ?? [ATTACK];
  if (star && char !== 'Mina' && !list.some((b) => b.key === 'KeyA')) return [...list, { key: 'KeyA', label: 'Estrella' }];
  if (star && char !== 'Mina') return list.map((b) => (b.key === 'KeyA' ? { ...b, label: b.label + '/★' } : b));
  return list;
}
