// Colour variants of the characters: the palettes of their sprite sheets, up to 4 per character. In a room nobody else can use the same
// colour of the same character (the server enforces it; svnz-backend src/game.ts VARIANTS has the same table).
import { DB } from '../fight/data';

export const VARIANTS: Record<string, number> = {
  Mina: 4, GenericNinja: 4, DemonNinja: 3, GoldDemonNinja: 4, Bat: 4, BigDemon: 3, Dracula: 3, XaHero: 1, XaBoss: 1,
};
export const variantCount = (char: string): number => VARIANTS[char] ?? 1;

/** Sheet (palette) of a variant: variant 0 is the character's usual colour, the next ones follow in the sheet. */
export function paletteOf(char: string, variant: number): number {
  const ce = DB.chars[char];
  if (!ce) return 0;
  const n = Math.max(1, ce.base.numberOfPalettes);
  return (Math.max(0, ce.base.color) + variant) % n;
}
