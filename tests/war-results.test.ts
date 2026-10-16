import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { currentWeek, shiftWeek } from "../src/lib/resources";
import type { Member } from "../src/lib/types";
import { initializeSchema, openDatabase, type Database } from "../src/lib/server/db";
import { ApiError } from "../src/lib/server/errors";
import { memberFromRow } from "../src/lib/server/mappers";
import { sendSnipeShoutout } from "../src/lib/server/reminders";
import { deleteWarResult, listWarResults, nameKey, parseReading, readWarScreenshots, recognition, saveWarResult, snipeRecognition } from "../src/lib/server/war-results";

const apiFailure = (code: string) => (error: unknown) => error instanceof ApiError && error.code === code;
const IMAGE = { mime: "image/jpeg" as const, data: "aGVsbG8gd29ybGQgaW1hZ2U=" };

async function withDatabase(work: (db: Database) => Promise<void>) {
  const db = await openDatabase({ localPath: "memory://" });
  try { await initializeSchema(db); await work(db); } finally { await db.close(); }
}

async function addMember(db: Database, username: string, role: Member["role"] = "MEMBER", displayName: string | null = null): Promise<Member> {
  const rows = await db.query("INSERT INTO app_members (id,discord_id,username,display_name,role) VALUES ($1,$2,$3,$4,$5) RETURNING *", [randomUUID(), randomUUID(), username, displayName, role]);
  return memberFromRow(rows[0]);
}

test("reader replies are cleaned: K/M numbers, commas, duplicates and unreadable rows", () => {
  const reading = parseReading(`Here you go:\n{"clanTotal":"12.5M","members":[
    {"name":"Lone Wolf","points":"1,234,567"},{"name":"lonewolf","points":5},
    {"name":"Ash","points":"35.6K"},{"name":"???","points":"n/a"},{"name":"","points":9}]}`);
  assert.equal(reading.clanTotal, 12_500_000);
  assert.deepEqual(reading.members, [{ name: "Lone Wolf", points: 1_234_567 }, { name: "Ash", points: 35_600 }]);
  assert.throws(() => parseReading("sorry, I can't"), apiFailure("WAR_READ_FAILED"));
  assert.equal(nameKey("  Lone-Wolf_77 "), "lonewolf77");
});

test("reading screenshots matches names to members and needs the key and an admin", async () => {
  await withDatabase(async (db) => {
    const admin = await addMember(db, "leader", "ADMIN");
    const member = await addMember(db, "lonewolf", "MEMBER", "Lone Wolf");
    const fetcher = (async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.messages[0].content[0].type, "image");
      return new Response(JSON.stringify({ content: [{ type: "text", text: '{"clanTotal":900,"members":[{"name":"Lone Wolf","points":500},{"name":"Stranger","points":400}]}' }] }));
    }) as typeof fetch;
    const previous = process.env.ANTHROPIC_API_KEY;
    try {
      delete process.env.ANTHROPIC_API_KEY;
      await assert.rejects(readWarScreenshots(admin, [IMAGE], { db, fetcher }), apiFailure("WAR_READER_NOT_CONFIGURED"));
      process.env.ANTHROPIC_API_KEY = "test-key";
      await assert.rejects(readWarScreenshots(member, [IMAGE], { db, fetcher }), apiFailure("ADMIN_REQUIRED"));
      const reading = await readWarScreenshots(admin, [IMAGE], { db, fetcher });
      assert.equal(reading.clanTotal, 900);
      assert.deepEqual(reading.rows, [{ gameName: "Lone Wolf", points: 500, memberId: member.id }, { gameName: "Stranger", points: 400, memberId: null }]);
    } finally {
      if (previous === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = previous;
    }
  });
});

test("saved results list newest first, remember matched names, and feed the latest-war numbers", async () => {
  await withDatabase(async (db) => {
    const admin = await addMember(db, "leader", "ADMIN");
    const member = await addMember(db, "ash");
    await assert.rejects(saveWarResult(member, { week: currentWeek(), label: "", clanTotal: 1, rows: [], images: [] }, db), apiFailure("ADMIN_REQUIRED"));
    await saveWarResult(admin, { week: shiftWeek(currentWeek(), -1), label: "War 1", clanTotal: 1000, rows: [], images: [] }, db);
    const saved = await saveWarResult(admin, {
      week: currentWeek(), label: "War 2", clanTotal: 2500,
      rows: [{ gameName: "AshTheGreat", memberId: member.id, points: 700 }, { gameName: "Guest", memberId: null, points: 900 }],
      images: [IMAGE],
    }, db);
    assert.deepEqual(saved.points.map(({ points }) => points), [900, 700]);
    assert.equal(saved.imageIds.length, 1);
    const listed = await listWarResults(member, db);
    assert.deepEqual(listed.results.map(({ label }) => label), ["War 2", "War 1"]);
    const recognised = await recognition(member, db);
    assert.equal(recognised.latestWar?.clanTotal, 2500);
    assert.deepEqual(recognised.latestWar?.points, { [member.id]: 700 });
    // "AshTheGreat" is now remembered as this member for the next reading.
    const remembered = await db.query("SELECT member_id FROM member_game_names WHERE game_name_key = 'ashthegreat'");
    assert.equal(remembered[0].member_id, member.id);
    await deleteWarResult(admin, saved.id, db);
    assert.equal((await listWarResults(member, db)).results.length, 1);
    assert.equal((await db.query("SELECT id FROM war_result_images")).length, 0);
  });
});

test("snipe counts feed badges, the leaderboard and the Monday Discord thank-you", async () => {
  await withDatabase(async (db) => {
    const admin = await addMember(db, "leader", "ADMIN");
    const sniper = await addMember(db, "sniper");
    const lastWeek = new Date(`${shiftWeek(currentWeek(), -1)}T12:00:00Z`).toISOString();
    for (const startsAt of [lastWeek, new Date(Date.now() - 60 * 86_400_000 * 2).toISOString()]) {
      const id = randomUUID();
      await db.query("INSERT INTO snipe_plans (id,title,starts_at,activities,archived,created_by) VALUES ($1,'S',$2,'[\"hammers\"]'::jsonb,FALSE,$3)", [id, startsAt, admin.id]);
      await db.query("INSERT INTO snipe_attendance (snipe_id,member_id,confirmed_by) VALUES ($1,$2,$3)", [id, sniper.id, admin.id]);
    }
    const counts = await snipeRecognition(db);
    assert.equal(counts.recent[sniper.id], 1);
    assert.equal(counts.total[sniper.id], 2);
    assert.deepEqual(counts.lastWeek, [sniper.id]);
    const previous = process.env.DISCORD_REMINDER_WEBHOOK_URL;
    let posted = "";
    try {
      process.env.DISCORD_REMINDER_WEBHOOK_URL = "https://discord.com/api/webhooks/1/abc";
      const result = await sendSnipeShoutout({ db, fetcher: (async (_url: string, init?: RequestInit) => { posted = String(init?.body); return new Response("{}"); }) as typeof fetch });
      assert.deepEqual(result, { posted: true, members: 1 });
      assert.match(posted, /Snipe Champions/);
      assert.match(posted, new RegExp(`<@${sniper.discordId}>`));
    } finally {
      if (previous === undefined) delete process.env.DISCORD_REMINDER_WEBHOOK_URL; else process.env.DISCORD_REMINDER_WEBHOOK_URL = previous;
    }
  });
});

test("the daily Discord check removes members who left and restores them if they return", async () => {
  const { syncDiscordMembers } = await import("../src/lib/server/discord-sync");
  await withDatabase(async (db) => {
    const admin = await addMember(db, "leader", "ADMIN");
    const stay = [await addMember(db, "a"), await addMember(db, "b"), await addMember(db, "c"), await addMember(db, "d")];
    const leaver = await addMember(db, "leaver");
    let inServer = [admin, ...stay].map((member) => member.discordId);
    const fetcher = (async () => new Response(JSON.stringify(inServer.map((id) => ({ user: { id }, roles: [] }))))) as typeof fetch;
    const previous = { token: process.env.DISCORD_BOT_TOKEN, guild: process.env.DISCORD_GUILD_ID };
    try {
      delete process.env.DISCORD_BOT_TOKEN;
      assert.equal((await syncDiscordMembers({ db, fetcher })).configured, false);
      process.env.DISCORD_BOT_TOKEN = "bot";
      process.env.DISCORD_GUILD_ID = "123";
      assert.deepEqual((await syncDiscordMembers({ db, fetcher })).removed, ["leaver"]);
      assert.equal((await db.query("SELECT active FROM app_members WHERE id=$1", [leaver.id]))[0].active, false);
      inServer = [...inServer, leaver.discordId];
      assert.deepEqual((await syncDiscordMembers({ db, fetcher })).restored, ["leaver"]);
      assert.equal((await db.query("SELECT active FROM app_members WHERE id=$1", [leaver.id]))[0].active, true);
      // An empty or broken member list never empties the roster.
      inServer = [];
      assert.match((await syncDiscordMembers({ db, fetcher })).skipped ?? "", /nothing was changed/);
      assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM app_members WHERE active")).at(0)?.n, 6);
    } finally {
      for (const [key, value] of [["DISCORD_BOT_TOKEN", previous.token], ["DISCORD_GUILD_ID", previous.guild]] as const) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    }
  });
});

test("the contribution ranking puts the least active members first", async () => {
  const { contributionRanking, percentile } = await import("../src/lib/server/ranking");
  assert.equal(percentile(5, [5]), 0.5);
  assert.equal(percentile(1, [1, 2, 3]), 0);
  assert.equal(percentile(3, [1, 2, 3]), 1);
  await withDatabase(async (db) => {
    const admin = await addMember(db, "leader", "ADMIN");
    const star = await addMember(db, "star");
    const idle = await addMember(db, "idle");
    await db.query("UPDATE app_members SET joined_at = NOW() - INTERVAL '60 days'");
    await saveWarResult(admin, { week: currentWeek(), label: "", clanTotal: 100, rows: [
      { gameName: "star", memberId: star.id, points: 900 }, { gameName: "leader", memberId: admin.id, points: 400 },
    ], images: [] }, db);
    await saveWarResult(admin, { kind: "vials", week: currentWeek(), label: "", clanTotal: null, rows: [{ gameName: "star", memberId: star.id, points: 50 }], images: [] }, db);
    await db.query("INSERT INTO dew_weekly_earnings (member_id, week_start, reason, amount) VALUES ($1, $2, 'resources', 20)", [star.id, currentWeek()]);
    await assert.rejects(contributionRanking(star, db), apiFailure("ADMIN_REQUIRED"));
    const ranking = await contributionRanking(admin, db);
    assert.equal(ranking.rows[0].member.id, idle.id);
    assert.equal(ranking.rows.at(-1)?.member.id, star.id);
    assert.equal(ranking.rows.find(({ member }) => member.id === star.id)?.vials, 50);
    assert.equal(ranking.records.wars, 1);
    assert.equal(ranking.weights.vials, 20);
    // Members there from the start aren't "new", even though the site is young.
    await db.query("UPDATE app_members SET joined_at = NOW() - INTERVAL '5 days'");
    assert.equal((await contributionRanking(admin, db)).rows.some((row) => row.isNew), false);
  });
});

test("clan members who never signed in are added from Discord and ranked with a big penalty", async () => {
  const { syncDiscordMembers } = await import("../src/lib/server/discord-sync");
  const { contributionRanking, NEVER_SIGNED_IN_PENALTY } = await import("../src/lib/server/ranking");
  const { registerDiscordMember } = await import("../src/lib/server/auth");
  await withDatabase(async (db) => {
    const admin = await addMember(db, "leader", "ADMIN");
    const fetcher = (async (url: string) => new Response(JSON.stringify(url.endsWith("/roles")
      ? [{ id: "r-clan", name: "Turmoil" }, { id: "r-guest", name: "Verified" }]
      : [
        { user: { id: admin.discordId, username: "leader" }, roles: ["r-clan"] },
        { user: { id: "555", username: "lurker", global_name: "Lurker" }, roles: ["r-clan"] },
        { user: { id: "666", username: "guest" }, roles: ["r-guest"] },
        { user: { id: "777", username: "somebot", bot: true }, roles: ["r-clan"] },
      ]))) as typeof fetch;
    const previous = { token: process.env.DISCORD_BOT_TOKEN, guild: process.env.DISCORD_GUILD_ID };
    try {
      process.env.DISCORD_BOT_TOKEN = "bot";
      process.env.DISCORD_GUILD_ID = "123";
      const result = await syncDiscordMembers({ db, fetcher });
      assert.deepEqual(result.added, ["Lurker"]);
      const rows = await db.query("SELECT discord_id, never_signed_in FROM app_members ORDER BY discord_id");
      assert.deepEqual(rows.map((row) => [row.discord_id, row.never_signed_in]).filter(([id]) => id !== admin.discordId), [["555", true]]);
      const ranking = await contributionRanking(admin, db);
      const lurker = ranking.rows.find(({ member }) => member.discordId === "555")!;
      assert.equal(lurker.member.neverSignedIn, true);
      assert.ok(lurker.penalty >= NEVER_SIGNED_IN_PENALTY);
      assert.equal(ranking.rows[0].member.discordId, "555");
      // Signing in for the first time clears the flag.
      const member = await registerDiscordMember({ id: "555", username: "lurker", global_name: "Lurker", avatar: null } as never, db);
      assert.equal(member.neverSignedIn, undefined);
      // A second sync doesn't add them again.
      assert.deepEqual((await syncDiscordMembers({ db, fetcher })).added, []);
    } finally {
      for (const [key, value] of [["DISCORD_BOT_TOKEN", previous.token], ["DISCORD_GUILD_ID", previous.guild]] as const) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    }
  });
});
