import { randomUUID } from "node:crypto";
import { COSMETIC_CATEGORIES, DEW_ITEMS, equippedCosmetics } from "../dew";
import { currentWeek } from "../resources";
import type { CosmeticCategory, DewResponse, Member, ResourceEntry, SnipePlan, SnipesResponse, WarActivity, WarRates } from "../types";
import { estimateWar, WAR_ACTIVITIES } from "../war";
import { database, lockAdministration, type Database, type SqlConnection } from "./db";
import { ApiError } from "./errors";
import { entryFromRow, iso, memberFromRow } from "./mappers";
import { getSettings } from "./settings";

interface SnipeInput {
  title: string;
  startsAt: string;
  activities: WarActivity[];
}

async function activeActor(tx: SqlConnection, actorId: string): Promise<Member> {
  const rows = await tx.query("SELECT * FROM app_members WHERE id = $1 AND active = TRUE FOR UPDATE", [actorId]);
  if (!rows.length) throw new ApiError(403, "Your tracker account is inactive.", "ACCOUNT_INACTIVE");
  return memberFromRow(rows[0]);
}

function requireAdministrator(actor: Member): void {
  if (actor.role !== "ADMIN") throw new ApiError(403, "Only administrators can manage snipe plans.", "ADMIN_REQUIRED");
}

function validatedSnipe(input: SnipeInput): SnipeInput {
  const title = input.title.trim();
  if (!title || title.length > 120) throw new ApiError(400, "Enter a snipe title of 1–120 characters.", "INVALID_SNIPE");
  const startsAt = new Date(input.startsAt);
  if (!Number.isFinite(startsAt.getTime()) || startsAt.getTime() <= Date.now()) {
    throw new ApiError(400, "Choose a future date and time for the snipe.", "INVALID_SNIPE_TIME");
  }
  const allowed = new Set(WAR_ACTIVITIES.map(({ key }) => key));
  if (!input.activities.length || input.activities.some((activity) => !allowed.has(activity))) {
    throw new ApiError(400, "Select at least one supported scoring activity.", "INVALID_SNIPE");
  }
  return { title, startsAt: startsAt.toISOString(), activities: [...new Set(input.activities)] };
}

function jsonValue<T>(value: unknown): T {
  return (typeof value === "string" ? JSON.parse(value) : value) as T;
}

async function planningContext(tx: SqlConnection): Promise<{ members: Member[]; entries: ResourceEntry[]; rates: WarRates }> {
  const memberRows = await tx.query("SELECT * FROM app_members WHERE active = TRUE ORDER BY LOWER(COALESCE(NULLIF(display_name, ''), username)), id");
  const bankRows = await tx.query(`SELECT b.*, COALESCE(NULLIF(editor.display_name, ''), editor.username) AS updated_by_username
    FROM member_banks b JOIN app_members owner ON owner.id = b.member_id
    JOIN app_members editor ON editor.id = b.updated_by WHERE owner.active = TRUE`);
  const settings = await getSettings(undefined, tx);
  return {
    members: memberRows.map(memberFromRow),
    entries: bankRows.map((row) => entryFromRow({ ...row, id: `bank:${row.member_id}`, week_start: currentWeek() })),
    rates: settings.warRates,
  };
}

async function planFromRow(tx: SqlConnection, row: Record<string, unknown>, context?: Awaited<ReturnType<typeof planningContext>>): Promise<SnipePlan> {
  if (row.archived === true && row.archived_result) return jsonValue<SnipePlan>(row.archived_result);
  const live = context ?? await planningContext(tx);
  const activities = jsonValue<WarActivity[]>(row.activities);
  const activeIds = new Set(live.members.map((member) => member.id));
  const responseRows = await tx.query("SELECT member_id, answer, updated_at FROM snipe_responses WHERE snipe_id = $1 ORDER BY member_id", [row.id]);
  const attendeeRows = await tx.query(`SELECT attendance.member_id, attendance.confirmed_by, attendance.confirmed_at, member.*
    FROM snipe_attendance attendance JOIN app_members member ON member.id = attendance.member_id
    WHERE attendance.snipe_id = $1 ORDER BY attendance.confirmed_at, attendance.member_id`, [row.id]);
  const responses: SnipePlan["responses"] = responseRows.filter((response) => activeIds.has(String(response.member_id))).map((response) => ({
    memberId: String(response.member_id), answer: response.answer as "yes" | "no", updatedAt: iso(response.updated_at)!,
  }));
  const participantIds = new Set(responses.filter((response) => response.answer === "yes").map((response) => response.memberId));
  const participants = live.members.filter((member) => participantIds.has(member.id)).map((member) => ({
    member, estimate: estimateWar(live.entries.filter((entry) => entry.memberId === member.id), live.rates, activities),
  }));
  return {
    id: String(row.id), title: String(row.title), startsAt: iso(row.starts_at)!, activities,
    archived: row.archived === true, createdBy: String(row.created_by), createdAt: iso(row.created_at)!,
    responses, participants,
    attendees: attendeeRows.map((attendee) => ({ memberId: String(attendee.member_id), confirmedBy: String(attendee.confirmed_by), confirmedAt: iso(attendee.confirmed_at)!, member: memberFromRow(attendee) })),
    counts: { yes: participants.length, no: responses.filter((response) => response.answer === "no").length, unanswered: live.members.length - responses.length },
    estimate: estimateWar(live.entries.filter((entry) => participantIds.has(entry.memberId)), live.rates, activities),
  };
}

async function findPlan(tx: SqlConnection, id: string): Promise<Record<string, unknown>> {
  const rows = await tx.query("SELECT * FROM snipe_plans WHERE id = $1 FOR UPDATE", [id]);
  if (!rows.length) throw new ApiError(404, "This snipe plan could not be found.", "SNIPE_NOT_FOUND");
  return rows[0];
}

function requireOpen(row: Record<string, unknown>): void {
  if (row.archived === true) throw new ApiError(409, "This snipe is archived and cannot be changed.", "SNIPE_ARCHIVED");
}

export async function listSnipes(actor: Member, db?: Database): Promise<SnipesResponse> {
  const connection = db ?? await database();
  return connection.transaction(async (tx) => {
    await lockAdministration(tx, connection.dialect);
    await activeActor(tx, actor.id);
    const rows = await tx.query("SELECT * FROM snipe_plans ORDER BY archived, starts_at DESC, created_at DESC");
    const context = rows.some((row) => row.archived !== true || !row.archived_result) ? await planningContext(tx) : undefined;
    const plans: SnipePlan[] = [];
    for (const row of rows) plans.push(await planFromRow(tx, row, context));
    return { plans };
  });
}

export async function createSnipe(actor: Member, input: SnipeInput, db?: Database): Promise<SnipePlan> {
  const connection = db ?? await database();
  return connection.transaction(async (tx) => {
    await lockAdministration(tx, connection.dialect);
    const freshActor = await activeActor(tx, actor.id);
    requireAdministrator(freshActor);
    const values = validatedSnipe(input);
    const rows = await tx.query(`INSERT INTO snipe_plans (id, title, starts_at, activities, archived, created_by)
      VALUES ($1, $2, $3, $4::jsonb, FALSE, $5) RETURNING *`, [randomUUID(), values.title, values.startsAt, JSON.stringify(values.activities), freshActor.id]);
    return planFromRow(tx, rows[0]);
  });
}

export async function updateSnipe(actor: Member, id: string, input: Partial<SnipeInput> & { archived?: boolean }, db?: Database): Promise<SnipePlan> {
  const connection = db ?? await database();
  return connection.transaction(async (tx) => {
    await lockAdministration(tx, connection.dialect);
    const freshActor = await activeActor(tx, actor.id);
    requireAdministrator(freshActor);
    let row = await findPlan(tx, id);
    if (input.archived === false) {
      // Moving a plan back to Open makes it live again, using everyone's latest resources.
      if (row.archived === true) [row] = await tx.query("UPDATE snipe_plans SET archived = FALSE, archived_result = NULL WHERE id = $1 RETURNING *", [id]);
      return planFromRow(tx, row);
    }
    requireOpen(row);
    if (input.title !== undefined || input.startsAt !== undefined || input.activities !== undefined) {
      const values = validatedSnipe({
        title: input.title ?? String(row.title), startsAt: input.startsAt ?? iso(row.starts_at)!,
        activities: input.activities ?? jsonValue<WarActivity[]>(row.activities),
      });
      [row] = await tx.query("UPDATE snipe_plans SET title = $2, starts_at = $3, activities = $4::jsonb WHERE id = $1 RETURNING *", [id, values.title, values.startsAt, JSON.stringify(values.activities)]);
    }
    const plan = await planFromRow(tx, row);
    if (input.archived === true) {
      plan.archived = true;
      await tx.query("UPDATE snipe_plans SET archived = TRUE, archived_result = $2::jsonb WHERE id = $1", [id, JSON.stringify(plan)]);
    }
    return plan;
  });
}

export async function respondToSnipe(actor: Member, id: string, input: { answer: "yes" | "no" }, db?: Database): Promise<SnipePlan> {
  const connection = db ?? await database();
  return connection.transaction(async (tx) => {
    await lockAdministration(tx, connection.dialect);
    const freshActor = await activeActor(tx, actor.id);
    const row = await findPlan(tx, id);
    requireOpen(row);
    if (new Date(iso(row.starts_at)!).getTime() <= Date.now()) throw new ApiError(409, "Attendance is closed because this snipe has started.", "SNIPE_STARTED");
    if (input.answer !== "yes" && input.answer !== "no") throw new ApiError(400, "Answer Yes or No for this snipe.", "INVALID_SNIPE_RESPONSE");
    await tx.query(`INSERT INTO snipe_responses (snipe_id, member_id, answer) VALUES ($1, $2, $3)
      ON CONFLICT (snipe_id, member_id) DO UPDATE SET answer = EXCLUDED.answer, updated_at = NOW()`, [id, freshActor.id, input.answer]);
    return planFromRow(tx, row);
  });
}

/** A snipe's attendance can still earn its reward when confirmed up to this long after it started. */
export const SNIPE_REWARD_WINDOW_MS = 8 * 24 * 60 * 60 * 1000;

async function attendeesFor(tx: SqlConnection, snipeId: string): Promise<NonNullable<SnipePlan["attendees"]>> {
  const rows = await tx.query(`SELECT attendance.member_id, attendance.confirmed_by, attendance.confirmed_at, member.*
    FROM snipe_attendance attendance JOIN app_members member ON member.id = attendance.member_id
    WHERE attendance.snipe_id = $1 ORDER BY attendance.confirmed_at, attendance.member_id`, [snipeId]);
  return rows.map((row) => ({ memberId: String(row.member_id), confirmedBy: String(row.confirmed_by), confirmedAt: iso(row.confirmed_at)!, member: memberFromRow(row) }));
}

/**
 * Attendance is an administrator's record of actual participation, separate from an RSVP.
 * Admins can tick or untick members after the snipe starts, including on archived snipes.
 * A confirmation earns that snipe week's 10 Clan Points (once per member per week) when it is
 * made within eight days of the start; removing a member's last attendance that week takes it back.
 */
export async function confirmSnipeAttendance(actor: Member, id: string, input: { memberId: string; attended: boolean }, db?: Database): Promise<SnipePlan> {
  const connection = db ?? await database();
  return connection.transaction(async (tx) => {
    await lockAdministration(tx, connection.dialect);
    const freshActor = await activeActor(tx, actor.id);
    requireAdministrator(freshActor);
    let row = await findPlan(tx, id);
    if (typeof input.attended !== "boolean") throw new ApiError(400, "Confirm actual attendance for this member.", "INVALID_SNIPE_ATTENDANCE");
    const startsAt = new Date(iso(row.starts_at)!);
    const now = new Date();
    if (startsAt.getTime() > now.getTime()) throw new ApiError(409, "Confirm attendance after this snipe has started.", "SNIPE_NOT_STARTED");
    const snipeWeek = currentWeek(startsAt);
    if (input.attended) {
      const target = await tx.query("SELECT id FROM app_members WHERE id = $1 AND active = TRUE FOR UPDATE", [input.memberId]);
      if (!target.length) throw new ApiError(404, "Choose an active clan member to confirm attendance.", "MEMBER_NOT_FOUND");
      await tx.query(`INSERT INTO snipe_attendance (snipe_id, member_id, confirmed_by)
        VALUES ($1, $2, $3) ON CONFLICT (snipe_id, member_id) DO NOTHING`, [id, input.memberId, freshActor.id]);
      // Old snipes keep their attendance record but cannot be used to farm points.
      if (now.getTime() - startsAt.getTime() <= SNIPE_REWARD_WINDOW_MS) await awardWeeklyDew(tx, input.memberId, "snipe", snipeWeek);
    } else {
      const removed = await tx.query("DELETE FROM snipe_attendance WHERE snipe_id = $1 AND member_id = $2 RETURNING member_id", [id, input.memberId]);
      if (removed.length) await withdrawSnipeReward(tx, input.memberId, snipeWeek);
    }
    if (row.archived === true && row.archived_result) {
      // Keep the frozen snapshot, refreshing only who attended. Earlier attendees keep their saved names.
      const frozen = jsonValue<SnipePlan>(row.archived_result);
      const previous = new Map((frozen.attendees ?? []).map((attendee) => [attendee.memberId, attendee]));
      frozen.attendees = (await attendeesFor(tx, id)).map((attendee) => previous.get(attendee.memberId) ?? attendee);
      [row] = await tx.query("UPDATE snipe_plans SET archived_result = $2::jsonb WHERE id = $1 RETURNING *", [id, JSON.stringify(frozen)]);
    }
    return planFromRow(tx, row);
  });
}

/** Takes back a week's snipe reward when the member no longer has any confirmed snipe that week. */
async function withdrawSnipeReward(tx: SqlConnection, memberId: string, week: string): Promise<void> {
  const plans = await tx.query(`SELECT plan.starts_at FROM snipe_attendance attendance
    JOIN snipe_plans plan ON plan.id = attendance.snipe_id WHERE attendance.member_id = $1`, [memberId]);
  if (plans.some((plan) => currentWeek(new Date(iso(plan.starts_at)!)) === week)) return;
  const earned = await tx.query(`DELETE FROM dew_weekly_earnings WHERE member_id = $1 AND week_start = $2 AND reason = 'snipe'
    RETURNING amount`, [memberId, week]);
  if (earned.length) await tx.query("UPDATE dew_balances SET balance = GREATEST(balance - $2, 0) WHERE member_id = $1", [memberId, Number(earned[0].amount)]);
}

async function dewResponse(tx: SqlConnection, actor: Member): Promise<DewResponse> {
  const rewardWeek = currentWeek();
  const balances = await tx.query("SELECT balance FROM dew_balances WHERE member_id = $1", [actor.id]);
  const earnings = await tx.query("SELECT member_id FROM dew_earnings WHERE member_id = $1 AND earned_on = (NOW() AT TIME ZONE 'UTC')::date", [actor.id]);
  const weeklyEarnings = await tx.query("SELECT reason, earned_at FROM dew_weekly_earnings WHERE member_id = $1 AND week_start = $2", [actor.id, rewardWeek]);
  const owned = await tx.query("SELECT item_id FROM dew_owned WHERE member_id = $1 ORDER BY purchased_at, item_id", [actor.id]);
  const cosmetics = equippedCosmetics(actor);
  return {
    balance: Number(balances[0]?.balance ?? 0),
    // Keep the older response field meaningful for browser tabs opened before this release.
    earnedToday: earnings.length > 0 || weeklyEarnings.some((row) => row.reason === "resources" && iso(row.earned_at)?.slice(0, 10) === new Date().toISOString().slice(0, 10)),
    rewardWeek,
    resourceRewardEarned: weeklyEarnings.some((row) => row.reason === "resources"),
    snipeRewardEarned: weeklyEarnings.some((row) => row.reason === "snipe"),
    equipped: cosmetics.badge, equippedCosmetics: cosmetics,
    owned: owned.map((row) => String(row.item_id)), items: DEW_ITEMS.map((item) => ({ ...item })),
  };
}

export async function getDew(actor: Member, db?: Database): Promise<DewResponse> {
  const connection = db ?? await database();
  return connection.transaction(async (tx) => {
    await lockAdministration(tx, connection.dialect);
    return dewResponse(tx, await activeActor(tx, actor.id));
  });
}

export async function awardWeeklyDew(tx: SqlConnection, memberId: string, reason: "resources" | "snipe", week: string): Promise<void> {
  const amount = reason === "resources" ? 20 : 10;
  const awarded = await tx.query(`INSERT INTO dew_weekly_earnings (member_id, week_start, reason, amount)
    SELECT id, $2::date, $3, $4 FROM app_members WHERE id = $1 AND active = TRUE
    ON CONFLICT (member_id, week_start, reason) DO NOTHING RETURNING member_id`, [memberId, week, reason, amount]);
  if (awarded.length) await tx.query(`INSERT INTO dew_balances (member_id, balance) VALUES ($1, $2)
    ON CONFLICT (member_id) DO UPDATE SET balance = dew_balances.balance + EXCLUDED.balance`, [memberId, amount]);
}

/** Call only inside a complete, validated self-bank save; unchanged saves can qualify once a week. */
export async function awardDewForBankUpdate(tx: SqlConnection, memberId: string, week = currentWeek()): Promise<void> {
  await awardWeeklyDew(tx, memberId, "resources", week);
}

export async function purchaseDewItem(actor: Member, itemId: string, db?: Database): Promise<DewResponse> {
  const connection = db ?? await database();
  return connection.transaction(async (tx) => {
    await lockAdministration(tx, connection.dialect);
    const freshActor = await activeActor(tx, actor.id);
    const item = DEW_ITEMS.find((candidate) => candidate.id === itemId);
    if (!item) throw new ApiError(404, "This reward could not be found.", "DEW_ITEM_NOT_FOUND");
    const alreadyOwned = await tx.query("SELECT item_id FROM dew_owned WHERE member_id = $1 AND item_id = $2", [freshActor.id, itemId]);
    // Retried purchases are safe: owning a reward never charges a second time.
    if (alreadyOwned.length) return dewResponse(tx, freshActor);
    const paid = await tx.query("UPDATE dew_balances SET balance = balance - $2 WHERE member_id = $1 AND balance >= $2 RETURNING balance", [freshActor.id, item.cost]);
    if (!paid.length) throw new ApiError(409, "You need more Clan Points to unlock this reward.", "INSUFFICIENT_DEW");
    await tx.query("INSERT INTO dew_owned (member_id, item_id) VALUES ($1, $2)", [freshActor.id, itemId]);
    return dewResponse(tx, freshActor);
  });
}

export async function equipDewItem(actor: Member, itemId: string | null, db?: Database, category?: CosmeticCategory): Promise<DewResponse> {
  const connection = db ?? await database();
  return connection.transaction(async (tx) => {
    await lockAdministration(tx, connection.dialect);
    const freshActor = await activeActor(tx, actor.id);
    const item = itemId === null ? undefined : DEW_ITEMS.find((candidate) => candidate.id === itemId);
    if (itemId !== null && !item) throw new ApiError(404, "This reward could not be found.", "DEW_ITEM_NOT_FOUND");
    const slot = category ?? item?.category ?? "badge";
    if (!COSMETIC_CATEGORIES.includes(slot) || (item && item.category !== slot)) {
      throw new ApiError(400, "Choose the matching cosmetic category for this reward.", "INVALID_COSMETIC_CATEGORY");
    }
    if (itemId !== null) {
      const owned = await tx.query("SELECT item_id FROM dew_owned WHERE member_id = $1 AND item_id = $2", [freshActor.id, itemId]);
      if (!owned.length) throw new ApiError(403, "Unlock this reward before equipping it.", "DEW_ITEM_NOT_OWNED");
    }
    const columns: Record<CosmeticCategory, string> = { badge: "badge", title: "cosmetic_title", accent: "cosmetic_accent", frame: "cosmetic_frame" };
    const rows = await tx.query(`UPDATE app_members SET ${columns[slot]} = $2 WHERE id = $1 RETURNING *`, [freshActor.id, itemId]);
    return dewResponse(tx, memberFromRow(rows[0]));
  });
}
