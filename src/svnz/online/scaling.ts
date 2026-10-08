// Cooperative difficulty. Same formula as the backend (svnz-backend/src/game.ts); online the backend sends the result with the
// match, so the numbers of its .env win. Local co-op uses these defaults.
import { rosterOf } from './roster';

export interface Difficulty {
  players: number;
  /** multiplier of the life of the enemies */
  hp: number;
  /** multiplier of how many enemies show up (on screen and per wave) */
  count: number;
  /** multiplier of the life of the bosses (already includes `hp`) */
  boss: number;
}

export const TUNING = { hpPerPlayer: 0.06, countPerPlayer: 0.75, bossHpPerPlayer: 0.5, cap: 2 };

export function difficultyOf(chars: string[], t = TUNING): Difficulty {
  const n = Math.max(1, chars.length);
  const threat = chars.reduce((s, c) => s + rosterOf(c).threat, 0);
  const hp = Math.min(t.cap, 1 + t.hpPerPlayer * (n - 1) + threat);
  const count = 1 + t.countPerPlayer * (n - 1);
  const boss = Math.min(t.cap * 2, (1 + t.bossHpPerPlayer * (n - 1)) * hp);
  const r = (x: number) => Math.round(x * 1000) / 1000;
  return { players: n, hp: r(hp), count: r(count), boss: r(boss) };
}

export const SOLO: Difficulty = { players: 1, hp: 1, count: 1, boss: 1 };
