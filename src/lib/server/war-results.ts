import { storedAwards } from "./awards";
import { randomUUID } from "node:crypto";
import { currentWeek, shiftWeek } from "../resources";
import { nameKey } from "../war-records";
import type { Member, RecognitionResponse, WarReading, WarResult, WarResultsResponse } from "../types";
import { database, type Database, type SqlConnection } from "./db";
import { ApiError } from "./errors";
import { iso, memberFromRow } from "./mappers";

export type ScreenshotImage = { mime: "image/jpeg" | "image/png" | "image/webp"; data: string };
/** "war" = end-of-war scores; "vials" = clan tech vial donations; "warday" = one war day's points. */
export type RecordKind = "war" | "vials" | "warday";

const SNIPE_RECENT_WEEKS = 8;

async function activeMember(connection: SqlConnection, actorId: string): Promise<Member> {
  const rows = await connection.query("SELECT * FROM app_members WHERE id = $1 AND active = TRUE", [actorId]);
  if (!rows.length) throw new ApiError(403, "Your tracker account is inactive.", "ACCOUNT_INACTIVE");
  return memberFromRow(rows[0]);
}

async function requireAdmin(connection: SqlConnection, actorId: string): Promise<Member> {
  const actor = await activeMember(connection, actorId);
  if (actor.role !== "ADMIN") throw new ApiError(403, "Only administrators can add war results.", "ADMIN_REQUIRED");
  return actor;
}

/** Shared with the browser, so names match the same way on both sides. */
export { nameKey };

/** Finds the clan member an in-game name belongs to: remembered matches first, then names that look the same. */
export async function matchGameNames(connection: SqlConnection, names: string[]): Promise<Map<string, string | null>> {
  const members = (await connection.query("SELECT * FROM app_members WHERE active = TRUE")).map(memberFromRow);
  const remembered = new Map((await connection.query("SELECT game_name_key, member_id FROM member_game_names"))
    .map((row) => [String(row.game_name_key), String(row.member_id)]));
  const rawRows = await connection.query("SELECT id, username, display_name, global_display_name FROM app_members WHERE active = TRUE");
  const byKey = new Map<string, string>();
  for (const row of rawRows) {
    for (const value of [row.display_name, row.global_display_name, row.username]) {
      if (typeof value === "string" && nameKey(value)) byKey.set(nameKey(value), String(row.id));
    }
  }
  const activeIds = new Set(members.map((member) => member.id));
  const result = new Map<string, string | null>();
  for (const name of names) {
    const key = nameKey(name);
    const known = remembered.get(key);
    result.set(name, known && activeIds.has(known) ? known : byKey.get(key) ?? null);
  }
  return result;
}

const VIALS_PROMPT = `These are screenshots of the clan tech donations screen from the mobile game Forge Masters,
showing how many vials each clan member has donated.
Read them and reply with ONLY a JSON object, no other text, in exactly this shape:
{"clanTotal": <total vials donated by the clan if shown as a whole number, otherwise null>,
 "members": [{"name": "<player name exactly as shown>", "points": <that player's vials donated as a whole number>}]}
Rules: list every player row you can see, top to bottom, once each (screenshots may overlap; skip duplicates).
Include players whose number is 0. Write numbers in full (e.g. "1.2K" becomes 1200, "1,234" becomes 1234).
Keep names exactly as written, including symbols. If you can read a name but not its number, include it with
"points": null. Never guess a number.`;

const READER_PROMPT = `These are screenshots of the end-of-war results from the mobile game Forge Masters.
Read them and reply with ONLY a JSON object, no other text, in exactly this shape:
{"clanTotal": <the clan's final total war points as a whole number, or null if not shown>,
 "members": [{"name": "<player name exactly as shown>", "points": <that player's war points as a whole number>}]}
Rules: list every player row you can see, top to bottom, once each (screenshots may overlap; skip duplicates).
Include players whose number is 0. Write numbers in full (e.g. "1.2M" becomes 1200000, "35.6K" becomes 35600,
"1,234,567" becomes 1234567). Keep names exactly as written, including symbols. If you can read a name but not its
number, include it with "points": null. Never guess a number.`;

const WAR_DAY_PROMPT = `These are screenshots of the clan war screen from the mobile game Forge Masters, showing how many
war points each clan member scored today.
Read them and reply with ONLY a JSON object, no other text, in exactly this shape:
{"clanTotal": <the clan's total points for today as a whole number, or null if not shown>,
 "members": [{"name": "<player name exactly as shown>", "points": <that player's points today as a whole number>}]}
Rules: list every player row you can see, top to bottom, once each (screenshots may overlap; skip duplicates).
Include players whose number is 0. Write numbers in full (e.g. "1.2M" becomes 1200000, "35.6K" becomes 35600,
"1,234,567" becomes 1234567). Keep names exactly as written, including symbols. If you can read a name but not its
number, include it with "points": null. Never guess a number.`;

const PROMPTS: Record<RecordKind, string> = { war: READER_PROMPT, vials: VIALS_PROMPT, warday: WAR_DAY_PROMPT };

function wholeNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return Math.round(value);
  if (typeof value === "string") {
    const match = value.replace(/,/g, "").trim().match(/^([\d.]+)\s*([kmb])?$/i);
    if (!match) return null;
    const scale = { k: 1e3, m: 1e6, b: 1e9 }[(match[2] ?? "").toLowerCase() as "k" | "m" | "b"] ?? 1;
    const number = Number(match[1]) * scale;
    return Number.isFinite(number) ? Math.round(number) : null;
  }
  return null;
}

/**
 * Turns the reader's reply into clean rows. A readable name whose number couldn't be read is kept with
 * points null, so an admin can type the number in instead of the player silently going missing.
 */
export function parseReading(text: string): { clanTotal: number | null; members: { name: string; points: number | null }[] } {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new ApiError(502, "The screenshots could not be read. Try clearer screenshots.", "WAR_READ_FAILED");
  let parsed: { clanTotal?: unknown; members?: unknown };
  try { parsed = JSON.parse(text.slice(start, end + 1)); }
  catch { throw new ApiError(502, "The screenshots could not be read. Try clearer screenshots.", "WAR_READ_FAILED"); }
  const byKey = new Map<string, { name: string; points: number | null }>();
  const members: { name: string; points: number | null }[] = [];
  for (const item of Array.isArray(parsed.members) ? parsed.members : []) {
    const name = typeof item?.name === "string" ? item.name.trim().slice(0, 80) : "";
    const points = wholeNumber(item?.points);
    const key = nameKey(name);
    // Nothing to go on: no readable name, or a name made only of symbols with no number either.
    if (!name || (!key && points === null)) continue;
    const seen = byKey.get(key || name);
    if (seen) {
      if (seen.points === null && points !== null) seen.points = points;
      continue;
    }
    const row = { name, points };
    byKey.set(key || name, row);
    members.push(row);
  }
  return { clanTotal: wholeNumber(parsed.clanTotal), members };
}

/** Sends the screenshots to Claude to read; an admin checks the result before anything is saved. */
export async function readWarScreenshots(
  actor: Member,
  images: ScreenshotImage[],
  dependencies: { db?: Database; fetcher?: typeof fetch; kind?: RecordKind } = {},
): Promise<WarReading> {
  const connection = dependencies.db ?? await database();
  await requireAdmin(connection, actor.id);
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new ApiError(503, "Screenshot reading isn’t set up yet. Add ANTHROPIC_API_KEY in Vercel, or type the numbers in.", "WAR_READER_NOT_CONFIGURED");
  const fetcher = dependencies.fetcher ?? fetch;
  const response = await fetcher("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: process.env.WAR_READER_MODEL || "claude-sonnet-5-5",
      max_tokens: 8000,
      messages: [{
        role: "user",
        content: [
          ...images.map((image) => ({ type: "image", source: { type: "base64", media_type: image.mime, data: image.data } })),
          { type: "text", text: PROMPTS[dependencies.kind ?? "war"] },
        ],
      }],
    }),
  });
  if (!response.ok) throw new ApiError(502, "The screenshot reader is unavailable right now. Try again, or type the numbers in.", "WAR_READ_FAILED");
  const body = await response.json() as { content?: { type: string; text?: string }[] };
  const text = (body.content ?? []).filter((part) => part.type === "text").map((part) => part.text ?? "").join("\n");
  const reading = parseReading(text);
  const matches = await matchGameNames(connection, reading.members.map(({ name }) => name));
  return {
    clanTotal: reading.clanTotal,
    rows: reading.members.map(({ name, points }) => ({ gameName: name, points, memberId: matches.get(name) ?? null })),
  };
}

export interface WarResultInput {
  kind?: RecordKind;
  /** Required for daily uploads ("warday"): which war day, 1–5. */
  warDay?: number | null;
  week: string;
  label: string;
  clanTotal: number | null;
  rows: { gameName: string; memberId: string | null; points: number }[];
  images: ScreenshotImage[];
}

type ResultRow = WarResultInput["rows"][number];

function assertHasContent(rows: ResultRow[], clanTotal: number | null): void {
  if (!rows.length && clanTotal === null) throw new ApiError(400, "Add the clan total or at least one member’s points.", "INVALID_WAR_RESULT");
}

async function assertMembersExist(tx: SqlConnection, rows: ResultRow[]): Promise<void> {
  const memberIds = [...new Set(rows.map((row) => row.memberId).filter((id): id is string => !!id))];
  for (const memberId of memberIds) {
    if (!(await tx.query("SELECT id FROM app_members WHERE id = $1", [memberId])).length) {
      throw new ApiError(404, "One of the chosen members could not be found.", "MEMBER_NOT_FOUND");
    }
  }
}

async function insertRows(tx: SqlConnection, id: string, rows: ResultRow[]): Promise<void> {
  for (const [position, row] of rows.entries()) {
    await tx.query("INSERT INTO war_result_points (result_id, position, game_name, member_id, points) VALUES ($1, $2, $3, $4, $5)",
      [id, position, row.gameName.trim().slice(0, 80), row.memberId, Math.round(row.points)]);
    // Remember who this in-game name belongs to, so next time it matches automatically.
    if (row.memberId && nameKey(row.gameName)) {
      await tx.query(`INSERT INTO member_game_names (game_name_key, member_id, updated_at) VALUES ($1, $2, NOW())
        ON CONFLICT (game_name_key) DO UPDATE SET member_id = EXCLUDED.member_id, updated_at = NOW()`, [nameKey(row.gameName), row.memberId]);
    }
  }
}

async function insertImages(tx: SqlConnection, id: string, images: ScreenshotImage[], firstPosition: number): Promise<string[]> {
  const ids: string[] = [];
  for (const [offset, image] of images.entries()) {
    const imageId = randomUUID();
    await tx.query("INSERT INTO war_result_images (id, result_id, position, mime, data) VALUES ($1, $2, $3, $4, $5)",
      [imageId, id, firstPosition + offset, image.mime, image.data]);
    ids.push(imageId);
  }
  return ids;
}

async function assertRecordExists(tx: SqlConnection, id: string): Promise<void> {
  if (!(await tx.query("SELECT id FROM war_results WHERE id = $1", [id])).length) {
    throw new ApiError(404, "This record could not be found.", "WAR_RESULT_NOT_FOUND");
  }
}

export async function saveWarResult(actor: Member, input: WarResultInput, db?: Database): Promise<WarResult> {
  const connection = db ?? await database();
  return connection.transaction(async (tx) => {
    const admin = await requireAdmin(tx, actor.id);
    const week = currentWeek(new Date(`${input.week}T12:00:00Z`));
    const kind = input.kind ?? "war";
    const warDay = kind === "warday" ? input.warDay ?? null : null;
    if (kind === "warday") {
      if (!warDay || warDay < 1 || warDay > 5) throw new ApiError(400, "Pick which war day (1–5) these points are for.", "INVALID_WAR_DAY");
      // One upload per war day; more screenshots for that day are added with Edit.
      const taken = await tx.query("SELECT id FROM war_results WHERE kind = 'warday' AND week_start = $1 AND war_day = $2", [week, warDay]);
      if (taken.length) throw new ApiError(409, "That war day already has an upload. Edit it to add more.", "WAR_DAY_TAKEN");
    }
    assertHasContent(input.rows, input.clanTotal);
    await assertMembersExist(tx, input.rows);
    const id = randomUUID();
    await tx.query("INSERT INTO war_results (id, week_start, label, clan_total, created_by, kind, war_day) VALUES ($1, $2, $3, $4, $5, $6, $7)",
      [id, week, input.label.trim().slice(0, 120), input.clanTotal, admin.id, kind, warDay]);
    await insertRows(tx, id, input.rows);
    await insertImages(tx, id, input.images, 0);
    return (await loadResults(tx, { id }))[0];
  });
}

export interface WarResultUpdate {
  label: string;
  clanTotal: number | null;
  rows: ResultRow[];
}

/** Admins fix a saved record: change numbers, add players the reader missed, or remove rows. Screenshots stay. */
export async function updateWarResult(actor: Member, id: string, input: WarResultUpdate, db?: Database): Promise<WarResult> {
  const connection = db ?? await database();
  return connection.transaction(async (tx) => {
    await requireAdmin(tx, actor.id);
    await assertRecordExists(tx, id);
    assertHasContent(input.rows, input.clanTotal);
    await assertMembersExist(tx, input.rows);
    await tx.query("UPDATE war_results SET label = $2, clan_total = $3 WHERE id = $1", [id, input.label.trim().slice(0, 120), input.clanTotal]);
    await tx.query("DELETE FROM war_result_points WHERE result_id = $1", [id]);
    await insertRows(tx, id, input.rows);
    return (await loadResults(tx, { id }))[0];
  });
}

/** The most screenshots one record keeps (a 50-member list takes about 8). */
export const MAX_RECORD_SCREENSHOTS = 20;

/**
 * Adds screenshots to a saved record. The site sends them one at a time after saving, so a long
 * member list never runs into the upload size limit.
 */
export async function addWarResultImages(actor: Member, id: string, images: ScreenshotImage[], db?: Database): Promise<{ imageIds: string[] }> {
  const connection = db ?? await database();
  return connection.transaction(async (tx) => {
    await requireAdmin(tx, actor.id);
    await assertRecordExists(tx, id);
    const stored = await tx.query("SELECT COUNT(*)::int AS count, COALESCE(MAX(position), -1)::int AS last FROM war_result_images WHERE result_id = $1", [id]);
    if (Number(stored[0].count) + images.length > MAX_RECORD_SCREENSHOTS) {
      throw new ApiError(400, `A record can keep up to ${MAX_RECORD_SCREENSHOTS} screenshots.`, "TOO_MANY_SCREENSHOTS");
    }
    return { imageIds: await insertImages(tx, id, images, Number(stored[0].last) + 1) };
  });
}

/** Loads records by id, or by kind (and optionally one week), newest first, with their rows and screenshot ids. */
export async function loadResults(connection: SqlConnection, filter: { id?: string; kind?: RecordKind; week?: string }): Promise<WarResult[]> {
  const where = filter.id ? "id = $1" : filter.week ? "kind = $1 AND week_start = $2" : "kind = $1";
  const params = filter.id ? [filter.id] : filter.week ? [filter.kind ?? "war", filter.week] : [filter.kind ?? "war"];
  const results = await connection.query(`SELECT *, week_start::text AS week_text FROM war_results WHERE ${where} ORDER BY week_start DESC, created_at DESC`, params);
  const points = await connection.query(`SELECT result_id, position, game_name, member_id, points FROM war_result_points
    WHERE result_id IN (SELECT id FROM war_results WHERE ${where}) ORDER BY result_id, position`, params);
  const images = await connection.query(`SELECT id, result_id FROM war_result_images
    WHERE result_id IN (SELECT id FROM war_results WHERE ${where}) ORDER BY result_id, position`, params);
  return results.map((row) => ({
    id: String(row.id),
    week: String(row.week_text).slice(0, 10),
    label: String(row.label),
    clanTotal: row.clan_total === null || row.clan_total === undefined ? null : Number(row.clan_total),
    createdAt: iso(row.created_at)!,
    createdBy: String(row.created_by),
    points: points.filter((point) => point.result_id === row.id).map((point) => ({
      position: Number(point.position), gameName: String(point.game_name),
      memberId: point.member_id ? String(point.member_id) : null, points: Number(point.points),
    })).sort((a, b) => b.points - a.points),
    imageIds: images.filter((image) => image.result_id === row.id).map((image) => String(image.id)),
    warDay: row.war_day === null || row.war_day === undefined ? null : Number(row.war_day),
  }));
}

export async function listWarResults(actor: Member, db?: Database, kind: RecordKind = "war"): Promise<WarResultsResponse> {
  const connection = db ?? await database();
  await activeMember(connection, actor.id);
  return { results: await loadResults(connection, { kind }) };
}

export async function deleteWarResult(actor: Member, id: string, db?: Database): Promise<void> {
  const connection = db ?? await database();
  await connection.transaction(async (tx) => {
    await requireAdmin(tx, actor.id);
    const removed = await tx.query("DELETE FROM war_results WHERE id = $1 RETURNING id", [id]);
    if (!removed.length) throw new ApiError(404, "This record could not be found.", "WAR_RESULT_NOT_FOUND");
  });
}

export async function warScreenshot(actor: Member, id: string, db?: Database): Promise<ScreenshotImage> {
  const connection = db ?? await database();
  await activeMember(connection, actor.id);
  const rows = await connection.query("SELECT mime, data FROM war_result_images WHERE id = $1", [id]);
  if (!rows.length) throw new ApiError(404, "This screenshot could not be found.", "WAR_IMAGE_NOT_FOUND");
  return { mime: rows[0].mime as ScreenshotImage["mime"], data: String(rows[0].data) };
}

/** Confirmed snipe attendance counts, used for badges, the leaderboard and the Discord thank-you. */
export async function snipeRecognition(connection: SqlConnection, now = new Date()) {
  const thisWeek = currentWeek(now);
  const recentStart = shiftWeek(thisWeek, -SNIPE_RECENT_WEEKS);
  const lastWeekStart = shiftWeek(thisWeek, -1);
  const rows = await connection.query(`SELECT attendance.member_id, plan.starts_at FROM snipe_attendance attendance
    JOIN snipe_plans plan ON plan.id = attendance.snipe_id
    JOIN app_members member ON member.id = attendance.member_id AND member.active = TRUE`);
  const recent: Record<string, number> = {};
  const total: Record<string, number> = {};
  const lastWeek = new Set<string>();
  for (const row of rows) {
    const memberId = String(row.member_id);
    const week = currentWeek(new Date(iso(row.starts_at)!));
    total[memberId] = (total[memberId] ?? 0) + 1;
    if (week >= recentStart) recent[memberId] = (recent[memberId] ?? 0) + 1;
    if (week === lastWeekStart) lastWeek.add(memberId);
  }
  return { recent, total, lastWeek: [...lastWeek] };
}

export async function recognition(actor: Member, db?: Database): Promise<RecognitionResponse> {
  const connection = db ?? await database();
  await activeMember(connection, actor.id);
  const latest = await connection.query("SELECT id FROM war_results WHERE kind = 'war' ORDER BY week_start DESC, created_at DESC LIMIT 1");
  const war = latest.length ? (await loadResults(connection, { id: String(latest[0].id) }))[0] : null;
  const points: Record<string, number> = {};
  for (const row of war?.points ?? []) if (row.memberId) points[row.memberId] = (points[row.memberId] ?? 0) + row.points;
  return {
    snipes: await snipeRecognition(connection),
    latestWar: war ? { id: war.id, week: war.week, label: war.label, clanTotal: war.clanTotal, points } : null,
    awards: await storedAwards(connection),
  };
}
