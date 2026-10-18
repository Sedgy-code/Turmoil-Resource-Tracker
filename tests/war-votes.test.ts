import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { Member } from "../src/lib/types";
import { initializeSchema, openDatabase, type Database } from "../src/lib/server/db";
import { ApiError } from "../src/lib/server/errors";
import { memberFromRow } from "../src/lib/server/mappers";
import { setClanDays } from "../src/lib/server/war-days";
import { getVotes, nextWarWeek, setVote, votingOpen } from "../src/lib/server/war-votes";

// The war that runs Tuesday 13 to Monday 19 October; the next one starts Tuesday 20 October.
const THURSDAY = new Date("2026-10-15T12:00:00Z"); // Day 3
const SUNDAY = new Date("2026-10-18T12:00:00Z"); // Day 6, the battle
const MONDAY = new Date("2026-10-19T10:00:00Z"); // Day 7, claim day
const TUESDAY = new Date("2026-10-20T10:00:00Z"); // Day 1 of the next war
const closed = (error: unknown) => error instanceof ApiError && error.code === "VOTING_CLOSED";

async function withDatabase(work: (db: Database) => Promise<void>) {
  const db = await openDatabase({ localPath: "memory://" });
  try { await initializeSchema(db); await work(db); } finally { await db.close(); }
}
async function addMember(db: Database, username: string, role: Member["role"] = "MEMBER"): Promise<Member> {
  const rows = await db.query("INSERT INTO app_members (id,discord_id,username,role) VALUES ($1,$2,$3,$4) RETURNING *", [randomUUID(), randomUUID(), username, role]);
  return memberFromRow(rows[0]);
}

test("a vote is two days at most: Day 6 is always fought", async () => {
  const { clanDayVoteSchema } = await import("../src/lib/server/validation");
  assert.deepEqual(clanDayVoteSchema.parse({ days: [1, 3] }).days, [1, 3]);
  assert.throws(() => clanDayVoteSchema.parse({ days: [1, 3, 5] }));
  assert.throws(() => clanDayVoteSchema.parse({ days: [6] }));
});

test("the vote is always for the war after the current one", () => {
  assert.equal(nextWarWeek(THURSDAY), "2026-10-19");
  assert.equal(nextWarWeek(SUNDAY), "2026-10-19");
  assert.equal(nextWarWeek(MONDAY), "2026-10-19");
  assert.equal(nextWarWeek(TUESDAY), "2026-10-26");
  assert.equal(votingOpen(THURSDAY, []), false);
  assert.equal(votingOpen(SUNDAY, []), true);
  assert.equal(votingOpen(MONDAY, []), true);
  assert.equal(votingOpen(MONDAY, [1, 3]), false);
});

test("members vote on Days 6 and 7 until leadership picks the days", async () => {
  await withDatabase(async (db) => {
    const leader = await addMember(db, "Leader", "ADMIN");
    const kael = await addMember(db, "Kael");
    const mira = await addMember(db, "Mira");
    const zed = await addMember(db, "Zed");
    // Mid-war, voting hasn't opened yet.
    await assert.rejects(setVote(kael, [1, 3], db, THURSDAY), closed);
    assert.equal((await getVotes(kael, db, THURSDAY)).open, false);
    // Battle day: votes count per day; days are kept in order and once each.
    const saved = await setVote(kael, [3, 1, 3], db, SUNDAY);
    assert.deepEqual(saved.mine, [1, 3]);
    // Voting earns 10 Clan Points once per war, not again for changing the vote.
    const balance = async (member: Member) => Number((await db.query("SELECT balance FROM dew_balances WHERE member_id = $1", [member.id]))[0]?.balance ?? 0);
    assert.equal(saved.rewarded, true);
    assert.equal(await balance(kael), 10);
    assert.deepEqual(await db.query("SELECT week_start::text AS week, reason, amount FROM dew_weekly_earnings WHERE member_id = $1", [kael.id]), [{ week: "2026-10-19", reason: "vote", amount: 10 }]);
    assert.equal((await setVote(kael, [1, 5], db, MONDAY)).rewarded, false);
    await setVote(kael, [1, 3], db, MONDAY);
    assert.equal(await balance(kael), 10);
    await setVote(mira, [1, 2], db, SUNDAY);
    assert.equal((await setVote(zed, [], db, MONDAY)).rewarded, false); // looked, but didn't pick any days
    assert.equal(await balance(zed), 0);
    const seen = await getVotes(zed, db, MONDAY);
    assert.deepEqual({ week: seen.week, open: seen.open, counts: seen.counts, pairs: seen.pairs, voters: seen.voters, mine: seen.mine }, {
      week: "2026-10-19", open: true, counts: [2, 1, 1, 0, 0], pairs: { "1,3": 1, "1,2": 1 }, voters: 2, mine: [],
    });
    // Changing a vote replaces it.
    await setVote(mira, [5], db, MONDAY);
    assert.deepEqual((await getVotes(leader, db, MONDAY)).counts, [1, 0, 1, 0, 1]);
    assert.equal((await getVotes(leader, db, MONDAY)).mine, null);
    // Members who left aren't counted.
    await db.query("UPDATE app_members SET active = FALSE WHERE id = $1", [mira.id]);
    assert.deepEqual((await getVotes(leader, db, MONDAY)).counts, [1, 0, 1, 0, 0]);
    // Once leadership picks the days, voting closes and shows what was picked.
    await setClanDays(leader, { week: "2026-10-19", days: [1, 3] }, db);
    const after = await getVotes(kael, db, MONDAY);
    assert.equal(after.open, false);
    assert.deepEqual(after.picked, [1, 3]);
    await assert.rejects(setVote(kael, [2], db, MONDAY), closed);
    // The next war's vote starts empty.
    assert.deepEqual((await getVotes(kael, db, TUESDAY)).counts, [0, 0, 0, 0, 0]);
  });
});
