import { currentWeek } from "../resources";
import { nextWarWeek, raceEnd, warDay, warWeekOf } from "../war-calendar";
import type { LeaderTodo, Member, StatusResponse, StatusRow } from "../types";
import { appUrl, isDemo } from "./config";
import { database, type Database, type SqlConnection } from "./db";
import { webhookLook } from "./discord-branding";
import { ApiError } from "./errors";
import { requireAdmin } from "./leadership";
import { iso, memberFromRow } from "./mappers";
import { clanDays } from "./war-days";
import { voteCounts, votingOpen } from "./war-votes";

const HOUR = 3_600_000;
const DISCORD_API = "https://discord.com/api/v10";
/** Snipes that started this long ago still show "check who came" on the leaders' to-do card. */
export const ATTENDANCE_TODO_MS = 36 * HOUR;

async function uploaded(connection: SqlConnection, week: string, kind: string, day?: number): Promise<boolean> {
  const rows = day === undefined
    ? await connection.query("SELECT 1 FROM war_results WHERE week_start = $1 AND kind = $2 LIMIT 1", [week, kind])
    : await connection.query("SELECT 1 FROM war_results WHERE week_start = $1 AND kind = $2 AND war_day = $3 LIMIT 1", [week, kind, day]);
  return rows.length > 0;
}

/**
 * What leadership should do now, for the to-do card on Home. Unlike the Discord reminders, each job
 * only shows on the days it can be done: daily points on Days 1–5, vials on Day 6 (the race resets
 * on Monday 00:00 UTC) and the end-of-war screenshots on Day 7.
 */
export async function leaderTodo(actor: Member, db?: Database, now = new Date()): Promise<LeaderTodo> {
  const connection = db ?? await database();
  await requireAdmin(connection, actor.id);
  const today = warDay(now);
  const todo: LeaderTodo = { warDay: null, clanDays: null, warResults: null, vials: null, attendance: [], unsaved: 0, away: 0 };
  if (today.day <= 5 && !(await uploaded(connection, warWeekOf(now), "warday", today.day))) {
    todo.warDay = { day: today.day, endsAt: today.nextDay.toISOString() };
  }
  // Days 1–5: this war's spending days. Days 6–7: the next war's, with what members voted for.
  const nextWar = today.day >= 6;
  const week = nextWar ? nextWarWeek(now) : warWeekOf(now);
  if (!(await clanDays(connection, week)).length) {
    todo.clanDays = { nextWar, voters: nextWar ? (await voteCounts(connection, week)).voters : 0 };
  }
  if (today.day === 7 && !(await uploaded(connection, warWeekOf(now), "war"))) todo.warResults = { closesAt: today.nextDay.toISOString() };
  if (today.day === 6 && !(await uploaded(connection, currentWeek(now), "vials"))) todo.vials = { closesAt: raceEnd(now).toISOString() };
  const snipes = await connection.query(
    `SELECT p.id, p.title, p.starts_at,
       (SELECT COUNT(*) FROM snipe_attendance a WHERE a.snipe_id = p.id)::int AS checked_in,
       (SELECT COUNT(*) FROM snipe_responses r WHERE r.snipe_id = p.id AND r.answer = 'yes')::int AS said_yes
     FROM snipe_plans p
     WHERE p.archived = FALSE AND p.starts_at <= $1 AND p.starts_at >= $2
     ORDER BY p.starts_at DESC LIMIT 3`,
    [now.toISOString(), new Date(now.getTime() - ATTENDANCE_TODO_MS).toISOString()],
  );
  todo.attendance = snipes.map((row) => ({ id: String(row.id), title: String(row.title), startsAt: iso(row.starts_at)!, checkedIn: Number(row.checked_in), saidYes: Number(row.said_yes) }));
  // The same counts as the status board.
  const weeks = await memberWeeks(connection, now);
  todo.unsaved = weeks.filter((item) => item.state === "notStarted").length;
  todo.away = weeks.filter((item) => item.state === "away").length;
  return todo;
}

/**
 * Each active member's clan week: saved (a complete save this week, or a leader saved for them),
 * away, or not started. Shared by the to-do card and the status board, so their counts agree.
 */
async function memberWeeks(connection: SqlConnection, now: Date) {
  const week = currentWeek(now);
  const rows = await connection.query(
    `SELECT m.*, b.updated_at AS bank_updated_at,
       EXISTS (SELECT 1 FROM dew_weekly_earnings e WHERE e.member_id = m.id AND e.week_start = $1::date AND e.reason = 'resources') AS rewarded,
       n.nudged_at, COALESCE(NULLIF(leader.display_name, ''), leader.username) AS nudged_by_name
     FROM app_members m
     LEFT JOIN member_banks b ON b.member_id = m.id
     LEFT JOIN member_nudges n ON n.member_id = m.id AND n.week_start = $1::date
     LEFT JOIN app_members leader ON leader.id = n.nudged_by
     WHERE m.active = TRUE`,
    [week],
  );
  return rows.map((row) => {
    const member = memberFromRow(row);
    const savedAt = iso(row.bank_updated_at);
    const saved = row.rewarded === true || (!!savedAt && currentWeek(new Date(savedAt)) === week);
    // holidayUntil is only set while the time away is still running.
    const state: StatusRow["state"] = saved ? "saved" : member.holidayUntil ? "away" : "notStarted";
    return { row, member, savedAt, state };
  });
}

/** Not started first (the members to chase), then away, then saved; names A–Z within each. */
const STATE_ORDER: Record<StatusRow["state"], number> = { notStarted: 0, away: 1, saved: 2 };

/**
 * Every active member's clan week at a glance for leadership: saved, not started or away, their
 * vote while voting is open, their answer to the next snipe, and whether a leader already nudged them.
 */
export async function statusBoard(actor: Member, db?: Database, now = new Date()): Promise<StatusResponse> {
  const connection = db ?? await database();
  await requireAdmin(connection, actor.id);
  const week = currentWeek(now);
  const weeks = await memberWeeks(connection, now);
  const voteWeek = nextWarWeek(now);
  const voting = votingOpen(now, await clanDays(connection, voteWeek));
  const votes = voting ? (await voteCounts(connection, voteWeek)).byMember : new Map<string, number[]>();
  const next = await connection.query("SELECT id, title, starts_at FROM snipe_plans WHERE archived = FALSE AND starts_at > $1 ORDER BY starts_at LIMIT 1", [now.toISOString()]);
  const snipe = next[0] ? { id: String(next[0].id), title: String(next[0].title), startsAt: iso(next[0].starts_at)! } : null;
  const answers = new Map<string, "yes" | "no">();
  if (snipe) {
    for (const row of await connection.query("SELECT member_id, answer FROM snipe_responses WHERE snipe_id = $1", [snipe.id])) {
      answers.set(String(row.member_id), row.answer === "yes" ? "yes" : "no");
    }
  }
  const rows: StatusRow[] = weeks.map(({ row, member, savedAt, state }) => {
    const vote = votes.get(member.id);
    return {
      member,
      state,
      savedAt,
      vote: vote?.length ? vote : null,
      snipe: answers.get(member.id) ?? null,
      remindersAllowed: row.reminders_allowed === true,
      nudge: row.nudged_at ? { by: String(row.nudged_by_name ?? ""), at: iso(row.nudged_at)! } : null,
    };
  });
  rows.sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || a.member.username.localeCompare(b.member.username, undefined, { sensitivity: "base" }));
  return { week, voting, snipe, rows };
}

/** The reminder a leader's nudge sends (English only, like every automatic Discord post). */
export function nudgeMessage(leader: string, link: string): string {
  return `👋 **Turmoil Clan Hub**: ${leader} is reminding you to save your resources this week (+20 Clan Points): ${link}`;
}

/** Sends the nudge: a Discord message from the site's bot, or a mention in the reminder channel if the member's messages are closed. */
async function deliverNudge(discordId: string, content: string, fetcher: typeof fetch): Promise<"dm" | "mention"> {
  const token = process.env.DISCORD_BOT_TOKEN;
  const webhook = process.env.DISCORD_REMINDER_WEBHOOK_URL;
  const webhookOk = !!webhook && /^https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\//.test(webhook);
  if (!token && !webhookOk) throw new ApiError(503, "Discord reminders aren’t set up yet.", "NUDGE_NOT_CONFIGURED");
  if (token && /^\d+$/.test(discordId)) {
    const headers = { Authorization: `Bot ${token}`, "Content-Type": "application/json" };
    const channel = await fetcher(`${DISCORD_API}/users/@me/channels`, { method: "POST", headers, body: JSON.stringify({ recipient_id: discordId }) }).catch(() => null);
    const channelId = channel?.ok ? String(((await channel.json().catch(() => ({}))) as { id?: unknown }).id ?? "") : "";
    if (channelId) {
      const sent = await fetcher(`${DISCORD_API}/channels/${channelId}/messages`, {
        method: "POST", headers,
        // No pings and no link previews.
        body: JSON.stringify({ content, allowed_mentions: { parse: [] }, flags: 4 }),
      }).catch(() => null);
      if (sent?.ok) return "dm";
    }
  }
  if (webhookOk) {
    const posted = await fetcher(webhook!, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...webhookLook(), content: `<@${discordId}> ${content}`, allowed_mentions: { parse: [], users: [discordId] } }),
    }).catch(() => null);
    if (posted?.ok) return "mention";
  }
  throw new ApiError(502, "Discord didn’t deliver the reminder. Try again later, or remind them in the clan chat.", "NUDGE_FAILED");
}

/**
 * A leader's one-tap reminder to a member who hasn't saved this week. Only for members who allowed
 * it, at most once per member per clan week, and never while they're away.
 */
export async function nudgeMember(actor: Member, memberId: string, dependencies: { db?: Database; fetcher?: typeof fetch; now?: Date } = {}): Promise<{ by: string; at: string }> {
  const connection = dependencies.db ?? await database();
  const now = dependencies.now ?? new Date();
  const week = currentWeek(now);
  return connection.transaction(async (tx) => {
    const leader = await requireAdmin(tx, actor.id);
    const rows = await tx.query("SELECT * FROM app_members WHERE id = $1 AND active = TRUE", [memberId]);
    if (!rows.length) throw new ApiError(404, "Member not found.", "MEMBER_NOT_FOUND");
    const target = rows[0];
    if (target.reminders_allowed !== true) throw new ApiError(409, "This member hasn’t allowed Discord reminders.", "NUDGE_NOT_ALLOWED");
    const member = memberFromRow(target);
    if (member.holidayUntil) throw new ApiError(409, "This member is away, so they aren’t reminded.", "NUDGE_AWAY");
    const saved = await tx.query("SELECT 1 FROM dew_weekly_earnings WHERE member_id = $1 AND week_start = $2::date AND reason = 'resources'", [memberId, week]);
    if (saved.length) throw new ApiError(409, "This member has already saved this week.", "NUDGE_SAVED");
    // Claim this week's nudge first, so two leaders tapping at once never send two messages.
    const claimed = await tx.query(
      `INSERT INTO member_nudges (member_id, week_start, nudged_by, nudged_at, channel) VALUES ($1, $2::date, $3, $4, 'dm')
       ON CONFLICT (member_id, week_start) DO NOTHING RETURNING nudged_at`,
      [memberId, week, leader.id, now.toISOString()],
    );
    if (!claimed.length) throw new ApiError(409, "This member was already reminded this week.", "NUDGE_ALREADY_SENT");
    // In the demo nothing is sent; on the real Hub a failed delivery undoes the claim (the transaction rolls back).
    const channel = isDemo() ? "demo" : await deliverNudge(member.discordId, nudgeMessage(leader.username, `${appUrl()}/resources`), dependencies.fetcher ?? fetch);
    if (channel !== "dm") await tx.query("UPDATE member_nudges SET channel = $3 WHERE member_id = $1 AND week_start = $2::date", [memberId, week, channel]);
    return { by: leader.username, at: now.toISOString() };
  });
}
