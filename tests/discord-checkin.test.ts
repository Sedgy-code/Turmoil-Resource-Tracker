import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { test } from "node:test";
import type { Member } from "../src/lib/types";
import { initializeSchema, openDatabase, type Database } from "../src/lib/server/db";
import { checkIn, handleInteraction, verifyDiscordSignature } from "../src/lib/server/discord-interactions";
import { memberFromRow } from "../src/lib/server/mappers";
import { getDew, listSnipes } from "../src/lib/server/planning";

async function withDatabase(work: (db: Database) => Promise<void>) {
  const db = await openDatabase({ localPath: "memory://" });
  try { await initializeSchema(db); await work(db); } finally { await db.close(); }
}

async function addMember(db: Database, username: string, role: Member["role"] = "MEMBER"): Promise<Member> {
  const rows = await db.query("INSERT INTO app_members (id,discord_id,username,role) VALUES ($1,$2,$3,$4) RETURNING *", [randomUUID(), String(Math.floor(Math.random() * 1e15)), username, role]);
  return memberFromRow(rows[0]);
}

async function addSnipe(db: Database, admin: Member, minutesFromNow: number, title = "Snipe") {
  const id = randomUUID();
  await db.query("INSERT INTO snipe_plans (id,title,starts_at,activities,archived,created_by) VALUES ($1,$2,$3,'[\"hammers\"]'::jsonb,FALSE,$4)",
    [id, title, new Date(Date.now() + minutesFromNow * 60_000).toISOString(), admin.id]);
  return id;
}

test("only requests signed with the app's key are accepted", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const raw = publicKey.export({ format: "der", type: "spki" }).subarray(12).toString("hex");
  const body = '{"type":1}';
  const timestamp = "1700000000";
  const signature = sign(null, Buffer.from(timestamp + body), privateKey).toString("hex");
  assert.equal(verifyDiscordSignature(body, signature, timestamp, raw), true);
  assert.equal(verifyDiscordSignature(body + " ", signature, timestamp, raw), false);
  assert.equal(verifyDiscordSignature(body, null, timestamp, raw), false);
});

test("members check in once for the open snipe and get the weekly reward", async () => {
  await withDatabase(async (db) => {
    const admin = await addMember(db, "Leader", "ADMIN");
    const member = await addMember(db, "Sniper");
    assert.match(await checkIn(member.discordId, null, db), /no snipe open/);
    const later = await addSnipe(db, admin, 120, "Later");
    assert.match(await checkIn(member.discordId, later, db), /opens 30 minutes before/);
    await addSnipe(db, admin, -10, "Live snipe");
    assert.match(await checkIn(member.discordId, null, db), /Checked in for \*\*Live snipe\*\*/);
    assert.match(await checkIn(member.discordId, null, db), /already checked in/);
    assert.equal((await getDew(member, db)).balance, 10);
    const plan = (await listSnipes(admin, db)).plans.find(({ title }) => title === "Live snipe")!;
    assert.deepEqual(plan.attendees?.map(({ memberId }) => memberId), [member.id]);
    assert.match(await checkIn("999", null, db), /not on Turmoil Clan Hub/);
  });
});

test("Discord interactions: ping, /checkin, and /snipe-start for admins only", async () => {
  await withDatabase(async (db) => {
    const admin = await addMember(db, "Leader", "ADMIN");
    const member = await addMember(db, "Sniper");
    assert.deepEqual(await handleInteraction({ type: 1 }, db), { type: 1 });
    const id = await addSnipe(db, admin, 5, "Starting soon");
    const denied = await handleInteraction({ type: 2, member: { user: { id: member.discordId } }, data: { name: "snipe-start" } }, db) as { data: { content: string } };
    assert.match(denied.data.content, /Only clan admins/);
    const started = await handleInteraction({ type: 2, member: { user: { id: admin.discordId } }, data: { name: "snipe-start" } }, db) as { data: { content: string; components: { components: { custom_id: string }[] }[] } };
    assert.match(started.data.content, /check-in is open/);
    assert.equal(started.data.components[0].components[0].custom_id, `checkin:${id}`);
    const pressed = await handleInteraction({ type: 3, member: { user: { id: member.discordId } }, data: { custom_id: `checkin:${id}` } }, db) as { data: { content: string; flags: number } };
    assert.match(pressed.data.content, /Checked in/);
    assert.equal(pressed.data.flags, 64);
  });
});

test("members check in from the Hub once the snipe is close, and get the weekly reward once", async () => {
  await withDatabase(async (db) => {
    const { checkInToSnipe } = await import("../src/lib/server/planning");
    const admin = await addMember(db, "Leader", "ADMIN");
    const member = await addMember(db, "Raider");
    const later = await addSnipe(db, admin, 120, "Tonight");
    await assert.rejects(checkInToSnipe(member, later, db), /opens 30 minutes before/);
    const soon = await addSnipe(db, admin, 10, "Now");
    const plan = await checkInToSnipe(member, soon, db);
    assert.deepEqual(plan.attendees?.map((attendee) => attendee.memberId), [member.id]);
    assert.equal((await getDew(member, db)).snipeRewardEarned, true);
    assert.equal((await getDew(member, db)).balance, 10);
    // Checking in twice keeps one attendance and one reward.
    await checkInToSnipe(member, soon, db);
    assert.equal((await getDew(member, db)).balance, 10);
    const old = await addSnipe(db, admin, -240, "Earlier");
    await assert.rejects(checkInToSnipe(member, old, db), /closed/);
  });
});
