import type { AscensionPillar, WarActivity, WarEstimate } from "./types";

/**
 * Helps leadership pick the two clan days for a war. Day 6 (the battle) is always fought, so the clan
 * needs to win two of Days 1–5 as well. Each pair of days is scored from the clan's saved resources.
 */

/** Which tracked activities score on each spending day (forge, tech and dungeon points aren't tracked). */
export const DAY_ACTIVITIES: Record<number, readonly WarActivity[]> = {
  1: ["hammers", "skillSummons"],
  2: ["mountSummons", "newMountMerges", "mountMerges"],
  3: ["hammers", "skillSummons", "eggMerges", "eggSummonMerges"],
  4: ["mountSummons", "newMountMerges", "mountMerges"],
  5: ["hammers", "eggMerges", "eggSummonMerges"],
};

/** The days where ascending each pillar adds points (forge: the forge upgrade days). */
export const PILLAR_DAYS: Record<AscensionPillar, readonly number[]> = { forge: [2, 4], skills: [1, 3], mounts: [2, 4], pets: [3, 5] };

export const SPENDING_DAYS = [1, 2, 3, 4, 5] as const;

/** Estimated points per activity: the middle of the low and high estimate. */
export function activityPoints(estimate: WarEstimate | null): Record<WarActivity, number> {
  const points = { hammers: 0, skillSummons: 0, mountSummons: 0, newMountMerges: 0, mountMerges: 0, eggMerges: 0, eggSummonMerges: 0 };
  for (const row of estimate?.rows ?? []) points[row.activity] = (row.minimum + row.maximum) / 2;
  return points;
}

/** Points the clan could score on each day if it spent everything that counts there (index 0 = Day 1). */
export function dayPoints(points: Record<WarActivity, number>): number[] {
  return SPENDING_DAYS.map((day) => DAY_ACTIVITIES[day].reduce((total, activity) => total + points[activity], 0));
}

export interface DayPair {
  days: [number, number];
  /** Points on the weaker of the two days, with shared resources split to balance them. */
  weaker: number;
  /** Points on each day with that split. */
  perDay: [number, number];
  /** Members who voted for both of these days. */
  votes: number;
  /** Members ascending a pillar that scores on one of these days. */
  ascending: Partial<Record<AscensionPillar, number>>;
}

/**
 * Every pair of spending days, strongest first. Resources that count on both days (hammers on Days
 * 1, 3 and 5, for example) can only be spent once, so they're split to make the weaker day as strong
 * as possible: winning a pair means winning both days.
 */
export function rankPairs(points: Record<WarActivity, number>, pairVotes: Record<string, number> = {}, ascending: Partial<Record<AscensionPillar, number>> = {}): DayPair[] {
  const pairs: DayPair[] = [];
  for (const a of SPENDING_DAYS) for (const b of SPENDING_DAYS) {
    if (b <= a) continue;
    const onA = new Set(DAY_ACTIVITIES[a]);
    const onB = new Set(DAY_ACTIVITIES[b]);
    let onlyA = 0, onlyB = 0, shared = 0;
    for (const activity of new Set([...onA, ...onB])) {
      if (onA.has(activity) && onB.has(activity)) shared += points[activity];
      else if (onA.has(activity)) onlyA += points[activity];
      else onlyB += points[activity];
    }
    // Give the shared resources to the weaker day first, then split what's left evenly.
    const toA = Math.min(shared, Math.max(0, (onlyB + shared - onlyA) / 2));
    const perDay: [number, number] = [onlyA + toA, onlyB + shared - toA];
    const boosts = Object.fromEntries(Object.entries(ascending)
      .filter(([pillar, count]) => count && PILLAR_DAYS[pillar as AscensionPillar].some((day) => day === a || day === b)));
    pairs.push({ days: [a, b], weaker: Math.min(...perDay), perDay, votes: pairVotes[`${a},${b}`] ?? 0, ascending: boosts });
  }
  return pairs.sort((x, y) => y.weaker - x.weaker || y.votes - x.votes || x.days[0] - y.days[0]);
}

/** Members ascending each pillar, from the week's answers. */
export function pillarCounts(ascending: { pillars: AscensionPillar[] }[]): Partial<Record<AscensionPillar, number>> {
  const counts: Partial<Record<AscensionPillar, number>> = {};
  for (const member of ascending) for (const pillar of member.pillars) counts[pillar] = (counts[pillar] ?? 0) + 1;
  return counts;
}
