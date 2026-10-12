import { randomUUID } from "node:crypto";
import { DEW_ITEMS } from "../dew";
import { currentWeek } from "../resources";
import type { DewResponse, Member, ResourceEntry, SnipePlan, SnipesResponse, WarActivity, WarRates } from "../types";
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

async function dewResponse(tx: SqlConnection, actor: Member): Promise<DewResponse> {
  const balances = await tx.query("SELECT balance FROM dew_balances WHERE member_id = $1", [actor.id]);
  const earnings = await tx.query("SELECT member_id FROM dew_earnings WHERE member_id = $1 AND earned_on = (NOW() AT TIME ZONE 'UTC')::date", [actor.id]);
  const owned = await tx.query("SELECT item_id FROM dew_owned WHERE member_id = $1 ORDER BY purchased_at, item_id", [actor.id]);
  return { balance: Number(balances[0]?.balance ?? 0), earnedToday: earnings.length > 0, equipped: actor.badge ?? null, owned: owned.map((row) => String(row.item_id)), items: DEW_ITEMS.map((item) => ({ ...item })) };
}

export async function getDew(actor: Member, db?: Database): Promise<DewResponse> {
  const connection = db ?? await database();
  return connection.transaction(async (tx) => {
    await lockAdministration(tx, connection.dialect);
    return dewResponse(tx, await activeActor(tx, actor.id));
  });
}

/** Call inside the changed self-bank update transaction; one reward per UTC day. */
export async function awardDewForBankUpdate(tx: SqlConnection, memberId: string): Promise<void> {
  const awarded = await tx.query(`INSERT INTO dew_earnings (member_id, earned_on)
    SELECT id, (NOW() AT TIME ZONE 'UTC')::date FROM app_members WHERE id = $1 AND active = TRUE
    ON CONFLICT (member_id, earned_on) DO NOTHING RETURNING member_id`, [memberId]);
  if (awarded.length) await tx.query(`INSERT INTO dew_balances (member_id, balance) VALUES ($1, 1)
    ON CONFLICT (member_id) DO UPDATE SET balance = dew_balances.balance + 1`, [memberId]);
}

export async function purchaseDewItem(actor: Member, itemId: string, db?: Database): Promise<DewResponse> {
  const connection = db ?? await database();
  return connection.transaction(async (tx) => {
    await lockAdministration(tx, connection.dialect);
    const freshActor = await activeActor(tx, actor.id);
    const item = DEW_ITEMS.find((candidate) => candidate.id === itemId);
    if (!item) throw new ApiError(404, "This Dew reward could not be found.", "DEW_ITEM_NOT_FOUND");
    const alreadyOwned = await tx.query("SELECT item_id FROM dew_owned WHERE member_id = $1 AND item_id = $2", [freshActor.id, itemId]);
    // Retried purchases are safe: owning a reward never charges a second time.
    if (alreadyOwned.length) return dewResponse(tx, freshActor);
    const paid = await tx.query("UPDATE dew_balances SET balance = balance - $2 WHERE member_id = $1 AND balance >= $2 RETURNING balance", [freshActor.id, item.cost]);
    if (!paid.length) throw new ApiError(409, "You need more Dew to unlock this reward.", "INSUFFICIENT_DEW");
    await tx.query("INSERT INTO dew_owned (member_id, item_id) VALUES ($1, $2)", [freshActor.id, itemId]);
    return dewResponse(tx, freshActor);
  });
}

export async function equipDewItem(actor: Member, itemId: string | null, db?: Database): Promise<DewResponse> {
  const connection = db ?? await database();
  return connection.transaction(async (tx) => {
    await lockAdministration(tx, connection.dialect);
    const freshActor = await activeActor(tx, actor.id);
    if (itemId !== null) {
      if (!DEW_ITEMS.some((item) => item.id === itemId)) throw new ApiError(404, "This Dew reward could not be found.", "DEW_ITEM_NOT_FOUND");
      const owned = await tx.query("SELECT item_id FROM dew_owned WHERE member_id = $1 AND item_id = $2", [freshActor.id, itemId]);
      if (!owned.length) throw new ApiError(403, "Unlock this badge before equipping it.", "DEW_ITEM_NOT_OWNED");
    }
    const rows = await tx.query("UPDATE app_members SET badge = $2 WHERE id = $1 RETURNING *", [freshActor.id, itemId]);
    return dewResponse(tx, memberFromRow(rows[0]));
  });
}
