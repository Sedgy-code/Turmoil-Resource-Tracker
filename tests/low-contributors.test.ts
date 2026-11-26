import assert from "node:assert/strict";
import { test } from "node:test";
import { lowContributors } from "../src/lib/low-contributors";
import type { ContributionRankingResponse, ContributionRow } from "../src/lib/types";

const row = (username: string, warPoints: number | null, warsPlayed: number) =>
  ({ member: { id: username, username }, warPoints, warsPlayed } as unknown as ContributionRow);

test("low contributors: under half of a typical member's war points, lowest first", () => {
  const ranking = {
    rows: [row("Ana", 1000, 4), row("Bo", 900, 4), row("Cy", 800, 4), row("Di", 300, 3), row("Ed", 0, 0), row("Fay", 450, 2)],
    weights: {}, records: { wars: 4, vials: 0 }, generatedAt: "",
  } as ContributionRankingResponse;
  const { rows, typical } = lowContributors(ranking);
  // Typical: the middle of those who played (Ana, Bo, Cy, Di, Fay) = 800. Half is 400.
  assert.equal(typical, 800);
  assert.deepEqual(rows.map((item) => item.member.username), ["Ed", "Di"]);
  // Members settling in aren't listed, and don't move the typical amount.
  const settling = { ...row("Gus", 0, 0), settling: true } as ContributionRow;
  const withSettler = lowContributors({ ...ranking, rows: [...ranking.rows, settling] });
  assert.deepEqual(withSettler.rows.map((item) => item.member.username), ["Ed", "Di"]);
  assert.equal(withSettler.typical, 800);
  // No war records yet: nobody listed.
  assert.deepEqual(lowContributors({ ...ranking, records: { wars: 0, vials: 0 } }).rows, []);
  assert.deepEqual(lowContributors(null).rows, []);
});
