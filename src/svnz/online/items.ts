// Power-ups of the online modes (VS and co-op). The sprites come from tools/build_powerups.py (PowerUps, anim id = item id,
// 11 + id = the 12x12 HUD icon). The room's host switches them on / off in the lobby.

export type ItemKey = 'star' | 'heart' | 'bolt' | 'shield' | 'fist' | 'fang';

export interface ItemInfo {
  key: ItemKey;
  /** animation id in the PowerUps sheet */
  id: number;
  name: string;
  blurb: string;
  /** seconds the effect lasts (0 = instant) */
  secs: number;
  /** only exists in co-op: nobody can be revived in VS */
  coopOnly?: boolean;
}

export const ITEMS: ItemInfo[] = [
  { key: 'star', id: 1, name: 'Estrella', blurb: 'Lanza estrellas ninja (Mina: Q / W, los demás: botón especial)', secs: 20 },
  { key: 'heart', id: 2, name: 'Corazón', blurb: 'Revive a un amigo caído', secs: 0, coopOnly: true },
  { key: 'bolt', id: 3, name: 'Rayo', blurb: 'Te hace mucho más rápido', secs: 12 },
  { key: 'shield', id: 4, name: 'Escudo', blurb: 'Recibís la mitad del daño y no te tambaleás', secs: 10 },
  { key: 'fist', id: 5, name: 'Fuerza', blurb: 'Tus golpes hacen un 40 % más de daño', secs: 12 },
  { key: 'fang', id: 6, name: 'Colmillo', blurb: 'Recuperás vida con lo que golpeás', secs: 12 },
];
export const itemInfo = (k: ItemKey): ItemInfo => ITEMS.find((i) => i.key === k)!;

export interface FightSettings { powerups: boolean; items: ItemKey[]; lives: number }

export function defaultSettings(mode: 'coop' | 'vs'): FightSettings {
  return { powerups: true, items: ITEMS.filter((i) => mode === 'coop' || !i.coopOnly).map((i) => i.key), lives: 3 };
}
/** No power-ups at all (local co-op, and the original modes). */
export const NO_POWERUPS: FightSettings = { powerups: false, items: [], lives: 3 };
