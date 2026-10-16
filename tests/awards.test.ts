import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { initializeSchema, openDatabase, type Database } from "../src/lib/server/db";
import { awardsMessage, computeAwards, previousMonth, sendMonthlyAwards, storedAwards } from "../src/lib/server/awards";

let db: Database;
const previous = { ...process.env };
const [ana, ben, cat] = [randomUUID(), randomUUID(), randomUUID()];
before(async () => {
  Object.assign(process.env, { NODE_ENV: "test", APP_URL: "https://tracker.example", DISCORD_REMINDER_WEBHOOK_URL: "https://discord.com/api/webhooks/1/abc" });
  db = await openDatabase();
  await initializeSchema(db);
  await db.query("INSERT INTO app_members (id, discord_id, username, role) VALUES ($1,'11','ana','ADMIN'), ($2,'22','ben','MEMBER'), ($3,'33','cat','MEMBER')", [ana, ben, cat]);
  const war = randomUUID();
  await db.query("INSERT INTO war_results (id, week_start, label, clan_total, created_by, kind) VALUES ($1, '2026-09-07', '', 100, $2, 'war')", [war, ana]);
  await db.query("INSERT INTO war_result_points (result_id, position, game_name, member_id, points) VALUES ($1,0,'Ben',$2,900), ($1,1,'Ana',$3,500)", [war, ben, ana]);
  const early = randomUUID(); const late = randomUUID();
  await db.query("INSERT INTO war_results (id, week_start, label, clan_total, created_by, kind, created_at) VALUES ($1,'2026-09-14','',0,$3,'vials','2026-09-15T00:00:00Z'), ($2,'2026-09-14','',0,$3,'vials','2026-09-18T00:00:00Z')", [early, late, ana]);
  await db.query("INSERT INTO war_result_points (result_id, position, game_name, member_id, points) VALUES ($1,0,'Cat',$3,10), ($2,0,'Cat',$3,70), ($2,1,'Ana',$4,40)", [early, late, cat, ana]);
  for (const week of ["2026-09-07", "2026-09-14"]) await db.query("INSERT INTO dew_weekly_earnings (member_id, week_start, reason, amount) VALUES ($1,$2,'resources',20)", [ana, week]);
  await db.query("INSERT INTO dew_weekly_earnings (member_id, week_start, reason, amount) VALUES ($1,'2026-09-07','resources',20)", [ben]);
});
after(async () => { await db.close(); process.env = previous; });

test("previous month in UTC", () => {
  assert.equal(previousMonth(new Date("2026-10-01T00:20:00Z")), "2026-09");
  assert.equal(previousMonth(new Date("2026-01-01T00:20:00Z")), "2025-12");
});

test("awards use war totals, each week's last vial upload, and full weekly saves", async () => {
  const awards = await computeAwards(db, "2026-09");
  const byKey = Object.fromEntries(awards.items.map((item) => [item.award, item]));
  assert.deepEqual(byKey.war.memberIds, [ben]);
  assert.equal(byKey.vials.value, 70);
  assert.deepEqual(byKey.vials.memberIds, [cat]);
  assert.deepEqual(byKey.saver.memberIds, [ana]);
  assert.equal(byKey.snipes, undefined);
  assert.match(awardsMessage(awards, (id) => `@${id === ben ? "ben" : "x"}`, "https://tracker.example"), /Top War Scorer:\*\* @ben \(900 war points\)/);
});

test("the monthly job stores awards and mentions only winners", async () => {
  const sent: { allowed_mentions: { users: string[] } }[] = [];
  const fetcher = (async (_url: string, init: RequestInit) => { sent.push(JSON.parse(String(init.body))); return new Response("{}", { status: 200 }); }) as typeof fetch;
  const result = await sendMonthlyAwards({ db, fetcher, now: new Date("2026-10-01T00:20:00Z") });
  assert.equal(result.posted, true);
  assert.deepEqual(sent[0].allowed_mentions.users.sort(), ["11", "22", "33"]);
  const stored = await storedAwards(db);
  assert.equal(stored?.month, "2026-09");
  assert.equal(stored?.items.length, 3);
});
