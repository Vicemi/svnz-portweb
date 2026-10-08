// The characters a player can pick in the VS / co-op modes. Their moves are the ones of the original game (characters.xml + the
// FighterStates decoded from svnz.exe): the same characters the Enemy Test levels let you control.

export interface RosterEntry {
  key: string;                 // characters.xml element
  name: string;
  /** life of a human player (characters.xml lifeHuman, tuned per character for the multiplayer modes) */
  life: number;
  /** how much stronger the enemies get when this character is in the team (cooperative difficulty) */
  threat: number;
  speed: string;
  style: string;
  moves: string[];
  /** starting state / height for characters that do not start standing */
  state?: string;
  yPos?: number;
  /** the XA characters: only selectable in VS (they have no place in the story co-op) */
  vsOnly?: boolean;
  /** balance for VS: damage dealt multiplier and no armor (so they cannot be an unbeatable counter) */
  dmg?: number;
  noArmor?: boolean;
}

export const ROSTER: RosterEntry[] = [
  { key: 'Mina', name: 'Mina', life: 400, threat: 0, speed: 'Media', style: 'Equilibrada',
    moves: ['Combos rapidos y fuertes (Q / W)', 'Salto, salto alto y patada en el aire', 'Dash y ataques con dash', 'Dos ataques especiales y uno en el aire (A)', 'Defensa y parry (S)'] },
  { key: 'GenericNinja', name: 'Ninja', life: 300, threat: 0, speed: 'Rapida', style: 'Agil',
    moves: ['Cadena de ataques de ninja', 'Muy veloz', 'Poca vida'] },
  { key: 'DemonNinja', name: 'Demon Ninja', life: 300, threat: 0.04, speed: 'Media', style: 'Garras',
    moves: ['Ataque de garras con gran alcance', 'Mas resistente que un ninja comun'] },
  { key: 'GoldDemonNinja', name: 'Gold Demon', life: 300, threat: 0.08, speed: 'Media', style: 'Blindado',
    moves: ['Armadura: recibe la mitad del dano y no se tambalea', 'Ataque de garras'] },
  { key: 'Bat', name: 'Murcielago', life: 150, threat: -0.02, speed: 'Muy rapida', style: 'Volador', state: 'Fly', yPos: 30,
    moves: ['Vuela por la arena', 'Mordisco en picada', 'Frágil: poca vida'] },
  { key: 'BigDemon', name: 'Big Demon', life: 300, threat: 0.1, speed: 'Lenta', style: 'Pesado',
    moves: ['Armadura: recibe la mitad del dano', 'Golpe fuerte', 'Body Slam: salta y cae con todo su peso'] },
  { key: 'Dracula', name: 'Dracula', life: 300, threat: 0.12, speed: 'Rapida', style: 'Vampiro',
    moves: ['Ataque combinado', 'Desplazamiento rapido', 'Patada voladora'] },
  { key: 'XaHero', name: 'XA Hero', life: 200, threat: 0, speed: 'Media', style: 'Tirador', vsOnly: true, dmg: 0.8,
    moves: ['Bola de energía (Q)', 'Salto y doble salto (E)', 'Escudo frontal (W): frena los golpes débiles', 'Menos vida y daño que el resto (equilibrado para VS)'] },
  { key: 'XaBoss', name: 'XA Boss', life: 260, threat: 0, speed: 'Lenta', style: 'Cañón', vsOnly: true, dmg: 0.65, noArmor: true,
    moves: ['Cañón de 5 disparos en abanico (Q)', 'Lento y grande', 'Sin armadura y con menos daño que el jefe original (equilibrado para VS)'] },
];

/** Characters that can be picked in a mode (the XA ones only in VS). */
export const rosterFor = (mode: 'coop' | 'vs'): RosterEntry[] => ROSTER.filter((r) => mode === 'vs' || !r.vsOnly);
export const rosterOf = (key: string): RosterEntry => ROSTER.find((r) => r.key === key) ?? ROSTER[0]!;

/** Colors of the player markers (P1..P8) drawn under the names and in the life lists. */
export const SLOT_COLORS = ['#ff4a4a', '#4aa3ff', '#ffd84a', '#5be07a', '#c77dff', '#ff9a3c', '#3ce0d0', '#ff7ac8'];
