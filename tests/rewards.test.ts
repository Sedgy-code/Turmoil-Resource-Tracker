import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { COSMETIC_CATEGORIES, DEW_ITEMS, EMPTY_EQUIPPED_COSMETICS, equippedCosmetics, REWARD_TIERS } from "../src/lib/dew";
import { currentWeek } from "../src/lib/resources";
import type { CosmeticCategory, Member } from "../src/lib/types";
import { initializeSchema, openDatabase, type Database } from "../src/lib/server/db";
import { ApiError } from "../src/lib/server/errors";
import { memberFromRow } from "../src/lib/server/mappers";
import { awardDewForBankUpdate, confirmSnipeAttendance, createSnipe, equipDewItem, getDew, listSnipes, purchaseDewItem, respondToSnipe, updateSnipe } from "../src/lib/server/planning";

const apiFailure = (code: string) => (error: unknown) => error instanceof ApiError && error.code === code;

async function withDatabase(work: (db: Database) => Promise<void>) {
  const db = await openDatabase({ localPath: "memory://" });
  try { await initializeSchema(db); await work(db); } finally { await db.close(); }
}

async function addMember(db: Database, username: string, role: Member["role"] = "MEMBER"): Promise<Member> {
  const rows = await db.query("INSERT INTO app_members (id,discord_id,username,role) VALUES ($1,$2,$3,$4) RETURNING *", [randomUUID(), randomUUID(), username, role]);
  return memberFromRow(rows[0]);
}

async function makeSnipe(db: Database, admin: Member, title = "Clan war") {
  return createSnipe(admin, { title, startsAt: new Date(Date.now() + 86_400_000).toISOString(), activities: ["hammers"] }, db);
}

async function startSnipe(db: Database, id: string) {
  await db.query("UPDATE snipe_plans SET starts_at=$2 WHERE id=$1", [id, new Date(Date.now() - 1_000).toISOString()]);
}

test("each new reward tier contains one of every cosmetic at the same individual price", () => {
  const items = DEW_ITEMS.filter((item) => !item.legacy);
  assert.equal(items.length, 20);
  assert.equal(new Set(DEW_ITEMS.map((item) => item.id)).size, DEW_ITEMS.length);
  for (const price of REWARD_TIERS) {
    const tier = items.filter((item) => item.cost === price);
    assert.equal(tier.length, 4);
    assert.deepEqual(tier.map((item) => item.category).sort(), [...COSMETIC_CATEGORIES].sort());
  }
  assert.deepEqual(DEW_ITEMS.filter((item) => item.legacy).map(({ id, cost, category }) => ({ id, cost, category })), [
    { id: "forge-scout", cost: 2, category: "badge" },
    { id: "anvil", cost: 2, category: "badge" },
    { id: "war-ready", cost: 3, category: "badge" },
    { id: "clan-champion", cost: 5, category: "badge" },
    { id: "phoenix", cost: 5, category: "badge" },
    { id: "emerald", cost: 3, category: "badge" },
  ]);
});

test("all four equipment slots are independent and old badge requests remain compatible", async () => {
  await withDatabase(async (db) => {
    const member = await addMember(db, "Collector");
    assert.deepEqual((await getDew(member, db)).equippedCosmetics, EMPTY_EQUIPPED_COSMETICS);
    await db.query("INSERT INTO dew_balances (member_id,balance) VALUES ($1,42)", [member.id]);
    await purchaseDewItem(member, "anvil", db);
    await equipDewItem(member, "anvil", db);
    const tier = DEW_ITEMS.filter((item) => !item.legacy && item.cost === 10);
    for (const item of tier) await purchaseDewItem(member, item.id, db);
    const decorations = tier.filter((item) => item.category !== "badge");
    await Promise.all(decorations.map((item) => equipDewItem(member, item.id, db)));
    const expected = { badge: "anvil", title: "keeper-of-the-bank", accent: "emerald-accent", frame: "emerald-frame" };
    const decorated = await getDew(member, db);
    assert.deepEqual(decorated.equippedCosmetics, expected);
    assert.equal(decorated.equipped, "anvil");
    assert.equal(decorated.balance, 0);
    assert.deepEqual((await equipDewItem(member, null, db)).equippedCosmetics, { ...expected, badge: null });
    await equipDewItem(member, "egg-whisperer", db, "badge");
    assert.deepEqual((await equipDewItem(member, null, db, "frame")).equippedCosmetics, { ...expected, badge: "egg-whisperer", frame: null });
    const row = (await db.query("SELECT * FROM app_members WHERE id=$1", [member.id]))[0];
    assert.deepEqual(memberFromRow(row).cosmetics, { ...expected, badge: "egg-whisperer", frame: null });
    assert.equal(memberFromRow(row).badge, "egg-whisperer");
    await initializeSchema(db);
    assert.deepEqual((await getDew(member, db)).equippedCosmetics, { ...expected, badge: "egg-whisperer", frame: null });
  });
});

test("equipment rejects unowned items and mismatched categories without changing other slots", async () => {
  await withDatabase(async (db) => {
    const member = await addMember(db, "Buyer");
    for (const item of DEW_ITEMS.filter((item) => !item.legacy && item.cost === 10)) {
      await assert.rejects(equipDewItem(member, item.id, db, item.category), apiFailure("DEW_ITEM_NOT_OWNED"));
    }
    await db.query("INSERT INTO dew_balances (member_id,balance) VALUES ($1,10)", [member.id]);
    await purchaseDewItem(member, "keeper-of-the-bank", db);
    await assert.rejects(equipDewItem(member, "keeper-of-the-bank", db, "badge"), apiFailure("INVALID_COSMETIC_CATEGORY"));
    await assert.rejects(equipDewItem(member, null, db, "role" as CosmeticCategory), apiFailure("INVALID_COSMETIC_CATEGORY"));
    assert.deepEqual((await getDew(member, db)).equippedCosmetics, EMPTY_EQUIPPED_COSMETICS);
    const equipped = await equipDewItem(member, "keeper-of-the-bank", db);
    assert.equal(equipped.equippedCosmetics.title, "keeper-of-the-bank");
    assert.equal(equipped.equipped, null);
  });
});

test("member cosmetics only expose catalog IDs from the matching category", () => {
  const member = memberFromRow({ id: "1", discord_id: "2", username: "Member", role: "MEMBER", active: true, joined_at: "2026-10-12T00:00:00Z", badge: "anvil", cosmetic_title: "keeper-of-the-bank", cosmetic_accent: "unknown", cosmetic_frame: "emerald-accent" });
  assert.deepEqual(member.cosmetics, { badge: "anvil", title: "keeper-of-the-bank", accent: null, frame: null });
  assert.equal(equippedCosmetics({ badge: "anvil", cosmetics: { badge: null } }).badge, null);
  assert.equal(equippedCosmetics({ badge: "anvil" }).badge, "anvil");
});

test("weekly rewards preserve old balances, daily history, purchases, and legacy badges", async () => {
  await withDatabase(async (db) => {
    const member = await addMember(db, "Veteran");
    await db.query("INSERT INTO dew_balances (member_id,balance) VALUES ($1,7)", [member.id]);
    await db.query("INSERT INTO dew_earnings (member_id,earned_on) VALUES ($1,(NOW() AT TIME ZONE 'UTC')::date)", [member.id]);
    await purchaseDewItem(member, "anvil", db);
    await equipDewItem(member, "anvil", db);
    await db.transaction((tx) => awardDewForBankUpdate(tx, member.id));
    await db.transaction((tx) => awardDewForBankUpdate(tx, member.id));
    const wallet = await getDew(member, db);
    assert.equal(wallet.balance, 25);
    assert.equal(wallet.rewardWeek, currentWeek());
    assert.equal(wallet.resourceRewardEarned, true);
    assert.equal(wallet.snipeRewardEarned, false);
    assert.equal(wallet.equipped, "anvil");
    assert.deepEqual(wallet.owned, ["anvil"]);
    assert.equal((await db.query("SELECT * FROM dew_earnings WHERE member_id=$1", [member.id])).length, 1);
    assert.equal((await db.query("SELECT * FROM dew_weekly_earnings WHERE member_id=$1", [member.id])).length, 1);
  });
});

test("only fresh administrators confirm actual attendance after start; RSVP alone earns nothing", async () => {
  await withDatabase(async (db) => {
    const admin = await addMember(db, "Admin", "ADMIN");
    const member = await addMember(db, "Member");
    const plan = await makeSnipe(db, admin);
    await respondToSnipe(member, plan.id, { answer: "yes" }, db);
    assert.equal((await getDew(member, db)).balance, 0);
    await assert.rejects(confirmSnipeAttendance(member, plan.id, { memberId: member.id, attended: true }, db), apiFailure("ADMIN_REQUIRED"));
    await assert.rejects(confirmSnipeAttendance(admin, plan.id, { memberId: member.id, attended: true }, db), apiFailure("SNIPE_NOT_STARTED"));
    await startSnipe(db, plan.id);
    await db.query("UPDATE app_members SET role='MEMBER' WHERE id=$1", [admin.id]);
    await assert.rejects(confirmSnipeAttendance(admin, plan.id, { memberId: member.id, attended: true }, db), apiFailure("ADMIN_REQUIRED"));
    await db.query("UPDATE app_members SET role='ADMIN' WHERE id=$1", [admin.id]);
    const confirmed = await confirmSnipeAttendance(admin, plan.id, { memberId: member.id, attended: true }, db);
    assert.equal(confirmed.attendees?.length, 1);
    assert.equal(confirmed.attendees?.[0].memberId, member.id);
    assert.equal(confirmed.attendees?.[0].confirmedBy, admin.id);
    assert.equal((await getDew(member, db)).balance, 10);
    assert.equal((await getDew(member, db)).snipeRewardEarned, true);
    const repeated = await confirmSnipeAttendance(admin, plan.id, { memberId: member.id, attended: true }, db);
    assert.deepEqual(repeated.attendees, confirmed.attendees);
    assert.equal((await getDew(member, db)).balance, 10);
    await updateSnipe(admin, plan.id, { archived: true }, db);
    assert.deepEqual((await listSnipes(member, db)).plans[0].attendees, confirmed.attendees);
    await assert.rejects(confirmSnipeAttendance(admin, plan.id, { memberId: member.id, attended: true }, db), apiFailure("SNIPE_ARCHIVED"));
  });
});

test("concurrent confirmations across several snipes award only ten points for the clan week", async () => {
  await withDatabase(async (db) => {
    const admin = await addMember(db, "Admin", "ADMIN");
    const member = await addMember(db, "Attendee");
    const first = await makeSnipe(db, admin, "First snipe");
    const second = await makeSnipe(db, admin, "Second snipe");
    await startSnipe(db, first.id);
    await startSnipe(db, second.id);
    await Promise.all([
      confirmSnipeAttendance(admin, first.id, { memberId: member.id, attended: true }, db),
      confirmSnipeAttendance(admin, first.id, { memberId: member.id, attended: true }, db),
      confirmSnipeAttendance(admin, second.id, { memberId: member.id, attended: true }, db),
    ]);
    await db.transaction((tx) => awardDewForBankUpdate(tx, member.id));
    const wallet = await getDew(member, db);
    assert.equal(wallet.balance, 30);
    assert.equal(wallet.resourceRewardEarned, true);
    assert.equal(wallet.snipeRewardEarned, true);
    assert.equal((await db.query("SELECT * FROM snipe_attendance WHERE member_id=$1", [member.id])).length, 2);
    assert.equal((await db.query("SELECT * FROM dew_weekly_earnings WHERE member_id=$1 AND reason='snipe'", [member.id])).length, 1);
  });
});

test("historical attendance is recorded without farming the current week's reward", async () => {
  await withDatabase(async (db) => {
    const admin = await addMember(db, "Admin", "ADMIN");
    const member = await addMember(db, "Attendee");
    const inactive = await addMember(db, "Former member");
    const plan = await makeSnipe(db, admin);
    await db.query("UPDATE snipe_plans SET starts_at=$2::date - INTERVAL '1 day' WHERE id=$1", [plan.id, currentWeek()]);
    const confirmed = await confirmSnipeAttendance(admin, plan.id, { memberId: member.id, attended: true }, db);
    assert.equal(confirmed.attendees?.length, 1);
    assert.equal((await getDew(member, db)).balance, 0);
    assert.equal((await getDew(member, db)).snipeRewardEarned, false);
    await db.query("UPDATE app_members SET active=FALSE WHERE id=$1", [inactive.id]);
    await assert.rejects(confirmSnipeAttendance(admin, plan.id, { memberId: inactive.id, attended: true }, db), apiFailure("MEMBER_NOT_FOUND"));
  });
});

test("archived attendance retains identities of non-RSVP members after rename and deactivation", async () => {
  await withDatabase(async (db) => {
    const admin = await addMember(db, "Admin", "ADMIN");
    const attendee = await addMember(db, "Original attendee");
    const former = await addMember(db, "Leaving attendee");
    const plan = await makeSnipe(db, admin);
    await startSnipe(db, plan.id);
    await confirmSnipeAttendance(admin, plan.id, { memberId: attendee.id, attended: true }, db);
    await confirmSnipeAttendance(admin, plan.id, { memberId: former.id, attended: true }, db);
    await db.query("UPDATE app_members SET active=FALSE WHERE id=$1", [former.id]);
    const archived = await updateSnipe(admin, plan.id, { archived: true }, db);
    assert.equal(archived.responses.length, 0);
    assert.equal(archived.participants.length, 0);
    assert.equal(archived.attendees?.find(({ memberId }) => memberId === attendee.id)?.member?.username, "Original attendee");
    assert.equal(archived.attendees?.find(({ memberId }) => memberId === former.id)?.member?.username, "Leaving attendee");
    await db.query("UPDATE app_members SET username='Renamed attendee',display_name='New display name',active=FALSE WHERE id=$1", [attendee.id]);
    await db.query("UPDATE app_members SET username='Renamed former member' WHERE id=$1", [former.id]);
    const frozen = (await listSnipes(admin, db)).plans.find(({ id }) => id === plan.id)!;
    assert.deepEqual(frozen.attendees, archived.attendees);
    assert.equal(frozen.attendees?.find(({ memberId }) => memberId === attendee.id)?.member?.username, "Original attendee");
    assert.equal(frozen.attendees?.find(({ memberId }) => memberId === former.id)?.member?.username, "Leaving attendee");
  });
});
