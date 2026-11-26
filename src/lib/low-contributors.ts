import type { ContributionRankingResponse, ContributionRow } from "./types";

/** The middle value, or 0 for none. */
function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Who adds the least in wars: average war points per war over the recent war records since each member
 * joined (the same numbers as the Ranking; missing one of those wars counts as 0). Listed when under half
 * of a typical member's, lowest first. Members settling in aren't listed.
 */
export function lowContributors(ranking: ContributionRankingResponse | null): { rows: ContributionRow[]; typical: number } {
  if (!ranking?.records.wars) return { rows: [], typical: 0 };
  const ranked = ranking.rows.filter((row) => !row.settling);
  const typical = median(ranked.filter((row) => row.warsPlayed > 0 && row.warPoints !== null).map((row) => row.warPoints!));
  const rows = ranked
    .filter((row) => row.warPoints !== null && row.warPoints < typical / 2)
    .sort((a, b) => a.warPoints! - b.warPoints! || a.member.username.localeCompare(b.member.username, undefined, { sensitivity: "base" }));
  return { rows, typical };
}
