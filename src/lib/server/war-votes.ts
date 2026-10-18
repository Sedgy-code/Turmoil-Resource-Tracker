import { nextWarWeek, warDay } from "../war-calendar";
import type { ClanDayVotes, Member } from "../types";
import { database, type Database, type SqlConnection } from "./db";
import { ApiError } from "./errors";
import { awardWeeklyDew } from "./planning";
import { clanDays, parseDays, SPENDING_DAYS } from "./war-days";

export { nextWarWeek };

/**
 * Members vote on Day 6 (battle) and Day 7 (claim) for the days they'd like to fight next war.
 * Voting closes once leadership picks that war's clan days, or when it starts.
 */
export function votingOpen(now: Date, picked: number[]): boolean {
  return warDay(now).day >= 6 && picked.length === 0;
}

async function requireActive(connection: SqlConnection, actorId: string): Promise<void> {
  const rows = await connection.query("SELECT 1 FROM app_members WHERE id = $1 AND active = TRUE", [actorId]);
  if (!rows.length) throw new ApiError(403, "Your tracker account is inactive.", "ACCOUNT_INACTIVE");
}

/**
 * How many active members voted for each spending day (index 0 = Day 1), for each pair of days
 * ("1,3"), and how many voted.
 */
export async function voteCounts(connection: SqlConnection, week: string): Promise<{ counts: number[]; pairs: Record<string, number>; voters: number; byMember: Map<string, number[]> }> {
  const rows = await connection.query(
    `SELECT v.member_id, v.days FROM clan_day_votes v JOIN app_members m ON m.id = v.member_id
     WHERE v.war_week = $1 AND m.active = TRUE`,
    [week],
  );
  const counts = SPENDING_DAYS.map(() => 0);
  const pairs: Record<string, number> = {};
  const byMember = new Map<string, number[]>();
  for (const row of rows) {
    const days = parseDays(String(row.days));
    byMember.set(String(row.member_id), days);
    for (const day of days) counts[day - 1]++;
    days.forEach((a, index) => days.slice(index + 1).forEach((b) => { pairs[`${a},${b}`] = (pairs[`${a},${b}`] ?? 0) + 1; }));
  }
  return { counts, pairs, voters: [...byMember.values()].filter((days) => days.length > 0).length, byMember };
}

export async function getVotes(actor: Member, db?: Database, now = new Date()): Promise<ClanDayVotes> {
  const connection = db ?? await database();
  await requireActive(connection, actor.id);
  const week = nextWarWeek(now);
  const picked = await clanDays(connection, week);
  const { counts, pairs, voters, byMember } = await voteCounts(connection, week);
  return { week, open: votingOpen(now, picked), picked, counts, pairs, voters, mine: byMember.get(actor.id) ?? null };
}

/**
 * Saves your vote for the next war (the days you'd like the clan to spend on). Voting for at least
 * one day earns 10 Clan Points, once per war; `rewarded` says whether this vote earned them.
 */
export async function setVote(actor: Member, days: number[], db?: Database, now = new Date()): Promise<ClanDayVotes> {
  const connection = db ?? await database();
  const week = nextWarWeek(now);
  const chosen = parseDays(days.join(","));
  const rewarded = await connection.transaction(async (tx) => {
    await requireActive(tx, actor.id);
    if (!votingOpen(now, await clanDays(tx, week))) {
      throw new ApiError(409, "Voting for the next war’s clan days is closed.", "VOTING_CLOSED");
    }
    await tx.query(
      `INSERT INTO clan_day_votes (member_id, war_week, days, updated_at) VALUES ($1, $2, $3, NOW())
       ON CONFLICT (member_id, war_week) DO UPDATE SET days = EXCLUDED.days, updated_at = NOW()`,
      [actor.id, week, chosen.join(",")],
    );
    return chosen.length > 0 && await awardWeeklyDew(tx, actor.id, "vote", week);
  });
  return { ...await getVotes(actor, connection, now), rewarded };
}
