import { AWARDS } from "../awards";
import { appUrl } from "./config";
import { database, type Database, type SqlConnection } from "./db";
import { webhookLook } from "./discord-branding";
import { ApiError } from "./errors";
import type { AwardKey, MonthlyAwards } from "../types";
import { numberFormat } from "../resources";

/** "2026-09" for the month before `now` (UTC). */
export function previousMonth(now = new Date()): string {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return date.toISOString().slice(0, 7);
}

function monthRange(month: string): { start: string; end: string } {
  const [year, number] = month.split("-").map(Number);
  return { start: new Date(Date.UTC(year, number - 1, 1)).toISOString().slice(0, 10), end: new Date(Date.UTC(year, number, 1)).toISOString().slice(0, 10) };
}

const winners = (totals: Map<string, number>) => {
  const best = Math.max(0, ...totals.values());
  return best > 0 ? { memberIds: [...totals].filter(([, value]) => value === best).map(([id]) => id), value: best } : null;
};

/** Works out a month's awards from war results, vial uploads, snipe check-ins and weekly saves. */
export async function computeAwards(connection: SqlConnection, month: string): Promise<MonthlyAwards> {
  const { start, end } = monthRange(month);
  const active = new Set((await connection.query("SELECT id FROM app_members WHERE active = TRUE")).map((row) => String(row.id)));
  const items: MonthlyAwards["items"] = [];
  const add = (award: AwardKey, totals: Map<string, number>) => {
    for (const id of [...totals.keys()]) if (!active.has(id)) totals.delete(id);
    const result = winners(totals);
    if (result) items.push({ award, ...result });
  };

  const war = await connection.query(`SELECT point.member_id, SUM(point.points) AS points FROM war_result_points point
    JOIN war_results result ON result.id = point.result_id
    WHERE result.kind = 'war' AND result.week_start >= $1::date AND result.week_start < $2::date AND point.member_id IS NOT NULL GROUP BY point.member_id`, [start, end]);
  add("war", new Map(war.map((row) => [String(row.member_id), Number(row.points)])));

  // Vials: the last upload of each week holds that week's donations.
  const vials = await connection.query(`SELECT point.member_id, SUM(point.points) AS points FROM war_result_points point
    JOIN (SELECT DISTINCT ON (week_start) id FROM war_results WHERE kind = 'vials' AND week_start >= $1::date AND week_start < $2::date ORDER BY week_start, created_at DESC) latest ON latest.id = point.result_id
    WHERE point.member_id IS NOT NULL GROUP BY point.member_id`, [start, end]);
  add("vials", new Map(vials.map((row) => [String(row.member_id), Number(row.points)])));

  const snipes = await connection.query(`SELECT attendance.member_id, COUNT(*)::int AS count FROM snipe_attendance attendance
    JOIN snipe_plans plan ON plan.id = attendance.snipe_id WHERE plan.starts_at >= $1::date AND plan.starts_at < $2::date GROUP BY attendance.member_id`, [start, end]);
  add("snipes", new Map(snipes.map((row) => [String(row.member_id), Number(row.count)])));

  // Saved every week that started in the month (everyone who did shares this one).
  const weeks = await connection.query(`SELECT COUNT(DISTINCT week_start)::int AS count FROM dew_weekly_earnings WHERE reason = 'resources' AND week_start >= $1::date AND week_start < $2::date`, [start, end]);
  const needed = Number(weeks[0]?.count ?? 0);
  if (needed > 0) {
    const savers = await connection.query(`SELECT member_id FROM dew_weekly_earnings WHERE reason = 'resources' AND week_start >= $1::date AND week_start < $2::date
      GROUP BY member_id HAVING COUNT(*) = $3`, [start, end, needed]);
    const ids = savers.map((row) => String(row.member_id)).filter((id) => active.has(id));
    if (ids.length) items.push({ award: "saver", memberIds: ids, value: needed });
  }
  return { month, items };
}

export async function storedAwards(connection: SqlConnection): Promise<MonthlyAwards | null> {
  const latest = await connection.query("SELECT MAX(month) AS month FROM monthly_awards");
  const month = latest[0]?.month ? String(latest[0].month) : null;
  if (!month) return null;
  const rows = await connection.query("SELECT award, member_id, value FROM monthly_awards WHERE month = $1 ORDER BY award", [month]);
  const items = new Map<AwardKey, MonthlyAwards["items"][number]>();
  for (const row of rows) {
    const award = String(row.award) as AwardKey;
    const item = items.get(award) ?? { award, memberIds: [], value: Number(row.value) };
    item.memberIds.push(String(row.member_id));
    items.set(award, item);
  }
  return { month, items: [...items.values()] };
}

export function awardsMessage(awards: MonthlyAwards, mention: (memberId: string) => string, link: string): string {
  const name = new Date(`${awards.month}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  const lines = awards.items.map((item) => {
    const award = AWARDS[item.award];
    const people = item.award === "saver" && item.memberIds.length > 8 ? `${item.memberIds.length} members` : item.memberIds.map(mention).join(", ");
    return `${award.emoji} **${award.title}:** ${people}${item.award === "saver" ? "" : ` (${numberFormat(item.value)} ${award.unit})`}`;
  });
  return [`🏅 **Turmoil awards for ${name}**`, "", ...lines, "", "Winners get the award badge next to their name on the Clan Hub this month. Thank you all — The Turmoil Way!", link].join("\n");
}

/** 1st of each month: save last month's awards and thank the winners in Discord. */
export async function sendMonthlyAwards(dependencies: { db?: Database; fetcher?: typeof fetch; now?: Date } = {}): Promise<{ month: string; posted: boolean; awards: number }> {
  const db = dependencies.db ?? await database();
  const month = previousMonth(dependencies.now);
  const awards = await computeAwards(db, month);
  await db.transaction(async (tx) => {
    await tx.query("DELETE FROM monthly_awards WHERE month = $1", [month]);
    for (const item of awards.items) for (const id of item.memberIds) {
      await tx.query("INSERT INTO monthly_awards (month, award, member_id, value) VALUES ($1, $2, $3, $4)", [month, item.award, id, item.value]);
    }
  });
  const webhook = process.env.DISCORD_REMINDER_WEBHOOK_URL;
  if (!awards.items.length || !webhook || !/^https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\//.test(webhook)) return { month, posted: false, awards: awards.items.length };
  const rows = await db.query("SELECT id, discord_id FROM app_members");
  const discordIds = new Map(rows.map((row) => [String(row.id), String(row.discord_id)]));
  const mentioned = [...new Set(awards.items.filter((item) => item.award !== "saver" || item.memberIds.length <= 8).flatMap((item) => item.memberIds))];
  const response = await (dependencies.fetcher ?? fetch)(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...webhookLook(),
      content: awardsMessage(awards, (id) => `<@${discordIds.get(id)}>`, appUrl()),
      allowed_mentions: { parse: [], users: mentioned.map((id) => discordIds.get(id)).filter(Boolean).slice(0, 100) },
    }),
  });
  if (!response.ok) throw new ApiError(502, "Discord did not accept the monthly awards.", "AWARDS_FAILED");
  return { month, posted: true, awards: awards.items.length };
}
