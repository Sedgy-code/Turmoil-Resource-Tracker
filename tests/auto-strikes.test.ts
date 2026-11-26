import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { Member } from "../src/lib/types";
import { applyAutoStrikes, AUTO_STRIKES_FROM, autoStrikeMessage } from "../src/lib/server/auto-strikes";
import { initializeSchema, openDatabase, type Database } from "../src/lib/server/db";
import { applyLeadershipAction, memberHistory } from "../src/lib/server/leadership";
import { memberFromRow } from "../src/lib/server/mappers";
import { reminderMessage } from "../src/lib/server/reminders";

async function withDatabase(work: (db: Database) => Promise<void>) {
  const db = await openDatabase({ localPath: "memory://" });
  try { await initializeSchema(db); await work(db); } finally { await db.close(); }
}
let discordIds = 100;
async function addMember(db: Database, username: string, role: Member["role"] = "MEMBER"): Promise<Member> {
  const rows = await db.query("INSERT INTO app_members (id,discord_id,username,role) VALUES ($1,$2,$3,$4) RETURNING *", [randomUUID(), String(discordIds++), username, role]);
  return memberFromRow(rows[0]);
}

// Wednesday 2 December 2026, 00:05 UTC: War Day 1 (Tuesday 1 December) has just ended.
const AFTER_DAY_1 = new Date("2026-12-02T00:05:00Z");
const WEEK = "2026-11-30";

test("after War Day 1, everyone who hasn't updated their resources gets one automatic strike", async () => {
  assert.equal(AUTO_STRIKES_FROM, WEEK);
  await withDatabase(async (db) => {
    const leader = await addMember(db, "Leader", "ADMIN");
    const saver = await addMember(db, "Saver");
    const banked = await addMember(db, "Banked");
    const away = await addMember(db, "Away");
    const idle = await addMember(db, "Idle");
    const lurker = await addMember(db, "Lurker");
    const closed = await addMember(db, "Closed");
    const gone = await addMember(db, "Gone");
    await db.query("INSERT INTO dew_weekly_earnings (member_id, week_start, reason, amount) VALUES ($1, $2, 'resources', 20)", [saver.id, WEEK]);
    // Saved this week without the +20 (or a leader saved for them): updated, as on the Status board.
    await db.query("INSERT INTO member_banks (member_id, updated_at, updated_by) VALUES ($1, '2026-11-30T09:00:00Z', $1)", [banked.id]);
    await db.query("UPDATE app_members SET holiday_until = '2026-12-10' WHERE id = $1", [away.id]);
    await db.query("UPDATE app_members SET never_signed_in = TRUE WHERE id = $1", [lurker.id]);
    await db.query("UPDATE app_members SET active = FALSE WHERE id = $1", [gone.id]);

    const sent: { url: string; body: { content: string; allowed_mentions: unknown; flags?: number; recipient_id?: string } }[] = [];
    const fetcher = (async (url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      sent.push({ url, body });
      // Closed has private messages from server members turned off.
      if (url.endsWith("/users/@me/channels")) return body.recipient_id === closed.discordId ? new Response("{}", { status: 403 }) : new Response(JSON.stringify({ id: `dm-${body.recipient_id}` }));
      return new Response("{}");
    }) as unknown as typeof fetch;
    const previous = process.env.DISCORD_BOT_TOKEN;
    try {
      process.env.DISCORD_BOT_TOKEN = "bot";
      const result = await applyAutoStrikes({ db, fetcher, now: AFTER_DAY_1 });
      // Leaders aren't skipped, and nor are members who never signed in: only holidays are.
      assert.deepEqual(result.struck, ["Closed", "Idle", "Leader", "Lurker"]);
      assert.deepEqual(result.notMessaged, ["Closed"]);
      assert.equal(result.posted, true);
      const strikes = await db.query("SELECT member_id, reason, created_by, auto_week::text AS week FROM member_strikes WHERE removed_at IS NULL");
      assert.equal(strikes.length, 4);
      assert.ok(strikes.every((row) => row.created_by === null && String(row.week).startsWith(WEEK)));
      assert.match(String(strikes[0].reason), /^Automatic: resources not updated by the end of War Day 1 \(war of Nov 30, 2026\)$/);

      // Each member gets a private message, with no pings and no link previews.
      const dms = sent.filter(({ url }) => /channels\/dm-/.test(url));
      assert.equal(dms.length, 3);
      assert.ok(dms.every(({ body }) => body.content === autoStrikeMessage(WEEK, "http://localhost:3000/resources") && JSON.stringify(body.allowed_mentions) === '{"parse":[]}'));
      // Leadership gets one silent list in their channel, names only.
      const list = sent.filter(({ url }) => url.endsWith("/channels/1504758222974746645/messages"));
      assert.equal(list.length, 1);
      assert.equal(list[0].body.flags, 4 | 4096);
      assert.deepEqual(list[0].body.allowed_mentions, { parse: [] });
      assert.match(list[0].body.content, /4 members hadn't updated their resources by the end of War Day 1: Closed, Idle, Leader, Lurker/);
      assert.match(list[0].body.content, /Couldn't send a private message to: Closed/);
      assert.doesNotMatch(list[0].body.content, /<@/);

      // Running again strikes nobody twice, even after a leader removes a strike.
      const idleStrike = (await db.query("SELECT id FROM member_strikes WHERE member_id = $1", [idle.id]))[0].id;
      await applyLeadershipAction(leader, idle.id, { action: "remove-strike", strikeId: String(idleStrike) }, db);
      const again = await applyAutoStrikes({ db, fetcher, now: new Date("2026-12-02T09:00:00Z") });
      assert.deepEqual(again.struck, []);
      assert.equal(again.posted, false);
      assert.equal(sent.length, 8, "nothing more was sent: 4 private channels opened, 3 messages, 1 list");

      // The member's history says the Clan Hub gave it.
      const history = await memberHistory(leader, lurker.id, db);
      assert.equal(history.strikes[0].createdBy, "Clan Hub (automatic)");
      assert.equal(history.member.strikes, 1);
    } finally {
      if (previous === undefined) delete process.env.DISCORD_BOT_TOKEN; else process.env.DISCORD_BOT_TOKEN = previous;
    }
  });
});

test("automatic strikes only run after Day 1 ends, while the war's clan week lasts, from the war of 30 November", async () => {
  await withDatabase(async (db) => {
    await addMember(db, "Idle");
    // Day 1 itself: members can still save.
    assert.match((await applyAutoStrikes({ db, now: new Date("2026-12-01T23:59:00Z") })).skipped ?? "", /isn't over/);
    // Monday (Day 7): a new clan week has started, so this war's saves can't be checked any more.
    assert.match((await applyAutoStrikes({ db, now: new Date("2026-12-07T00:05:00Z") })).skipped ?? "", /isn't over|has ended/);
    // The war before: no automatic strikes yet.
    assert.match((await applyAutoStrikes({ db, now: new Date("2026-11-25T00:05:00Z") })).skipped ?? "", /start with the war of 30 November/);
    assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM member_strikes"))[0].n, 0);
  });
});

test("the weekly reminder warns about the automatic strike", () => {
  const message = reminderMessage(["<@1>"], "https://x");
  assert.match(message, /Not saved by the end of Day 1 \(Wednesday 00:00 UTC\) means an automatic strike\./);
});
