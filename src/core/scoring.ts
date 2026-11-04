export const BASE_POINTS = 1000;
export const MAX_SPEED_BONUS = 500;

export function scoreAnswer(a: {
  correct: boolean;
  elapsedMs: number;
  limitMs: number;
  basePoints?: number;
  maxSpeedBonus?: number;
}): number {
  if (!a.correct) return 0;
  const base = a.basePoints ?? BASE_POINTS;
  const maxBonus = a.maxSpeedBonus ?? MAX_SPEED_BONUS;
  const elapsed = Math.min(Math.max(a.elapsedMs, 0), a.limitMs);
  return base + Math.round(maxBonus * (1 - elapsed / a.limitMs));
}

export interface Rankable {
  id: string;
  score: number;
  correctTimeMs: number;
}

export type Ranked<T extends Rankable> = T & { rank: number };

/** Highest score first; ties go to lower correctTimeMs; still tied → shared rank (1,1,3). */
export function rankPlayers<T extends Rankable>(players: T[]): Ranked<T>[] {
  const sorted = [...players].sort((a, b) => b.score - a.score || a.correctTimeMs - b.correctTimeMs);
  const out: Ranked<T>[] = [];
  sorted.forEach((p, i) => {
    const prev = out[i - 1];
    const tied = prev && prev.score === p.score && prev.correctTimeMs === p.correctTimeMs;
    out.push({ ...p, rank: tied ? prev.rank : i + 1 });
  });
  return out;
}

/** First n entries plus anyone sharing the nth entry's rank. */
export function topRanks<T extends { rank: number }>(ranked: T[], n: number): T[] {
  if (ranked.length <= n) return ranked;
  const cutoff = ranked[n - 1].rank;
  return ranked.filter((p, i) => i < n || p.rank === cutoff);
}
