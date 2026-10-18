import { warDay, warWeekOf } from "../war-calendar";
import { currentWeek } from "../resources";
import { appUrl } from "./config";
import { database, type Database } from "./db";
import { webhookLook } from "./discord-branding";
import { ApiError } from "./errors";
import { clanDays } from "./war-days";
import { voteCounts } from "./war-votes";
import { snipeRecognition } from "./war-results";

export interface ReminderResult {
  week: string;
  pending: number;
  posted: boolean;
}

/** Active members who have not yet saved a complete bank (earned the +20) this clan week. */
export async function membersWithoutWeeklyUpdate(db: Database, week = currentWeek()): Promise<{ discordId: string; name: string }[]> {
  const rows = await db.query(
    `SELECT m.discord_id, COALESCE(NULLIF(m.display_name, ''), m.username) AS name
     FROM app_members m
     WHERE m.active = TRUE AND (m.holiday_until IS NULL OR m.holiday_until < $1::date) AND NOT EXISTS (
       SELECT 1 FROM dew_weekly_earnings e
       WHERE e.member_id = m.id AND e.week_start = $1::date AND e.reason = 'resources'
     )
     ORDER BY LOWER(COALESCE(NULLIF(m.display_name, ''), m.username))`,
    [week],
  );
  return rows.map((row) => ({ discordId: String(row.discord_id), name: String(row.name) }));
}

/**
 * Sent Monday 12:00 UTC (vercel.json): the gap day between wars, once rewards are claimed, so
 * leadership has fresh numbers before Day 1. English only: the server's translation bot does the rest.
 */
export function reminderMessage(mentions: string[], link: string): string {
  return [
    "📋 **Weekly resource update**",
    mentions.join(" "),
    "",
    `Please save your resources before Clan War Day 1 starts (Tuesday 00:00 UTC) (+20 Clan Points): ${link}`,
  ].join("\n");
}

/** Posts the reminder to the Discord channel webhook set in DISCORD_REMINDER_WEBHOOK_URL. */
export async function sendWeeklyReminder(
  dependencies: { db?: Database; fetcher?: typeof fetch } = {},
): Promise<ReminderResult> {
  const webhook = process.env.DISCORD_REMINDER_WEBHOOK_URL;
  if (!webhook || !/^https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\//.test(webhook)) {
    throw new ApiError(503, "Set DISCORD_REMINDER_WEBHOOK_URL to a Discord webhook to send reminders.", "REMINDER_NOT_CONFIGURED");
  }
  const db = dependencies.db ?? await database();
  const week = currentWeek();
  const pending = await membersWithoutWeeklyUpdate(db, week);
  if (!pending.length) return { week, pending: 0, posted: false };
  // Discord messages are capped at 2,000 characters; long lists are split.
  const link = `${appUrl()}/resources`;
  const chunks: string[][] = [[]];
  for (const member of pending) {
    const current = chunks[chunks.length - 1];
    if (current.length >= 40) chunks.push([]);
    chunks[chunks.length - 1].push(`<@${member.discordId}>`);
  }
  const fetcher = dependencies.fetcher ?? fetch;
  for (const mentions of chunks) {
    const response = await fetcher(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...webhookLook(),
        content: reminderMessage(mentions, link),
        // Only ping the listed members, never @everyone or roles.
        allowed_mentions: { parse: [], users: mentions.map((mention) => mention.slice(2, -1)) },
      }),
    });
    if (!response.ok) throw new ApiError(502, "Discord did not accept the reminder.", "REMINDER_FAILED");
  }
  return { week, pending: pending.length, posted: true };
}

/** Thank-you post naming everyone confirmed at a snipe last clan week, with their recent count (English only). */
export function shoutoutMessage(lines: string[], link: string): string {
  return [
    "🎯 **Snipe Champions**",
    "",
    "Thank you to everyone who joined last week's snipes!",
    "",
    ...lines,
    "",
    link,
  ].join("\n");
}

export async function sendSnipeShoutout(
  dependencies: { db?: Database; fetcher?: typeof fetch; now?: Date } = {},
): Promise<{ posted: boolean; members: number }> {
  const webhook = process.env.DISCORD_REMINDER_WEBHOOK_URL;
  if (!webhook || !/^https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\//.test(webhook)) return { posted: false, members: 0 };
  const db = dependencies.db ?? await database();
  const counts = await snipeRecognition(db, dependencies.now ?? new Date());
  if (!counts.lastWeek.length) return { posted: false, members: 0 };
  const rows = await db.query("SELECT id, discord_id FROM app_members WHERE active = TRUE");
  const discordIds = new Map(rows.map((row) => [String(row.id), String(row.discord_id)]));
  const champions = counts.lastWeek
    .filter((id) => discordIds.has(id))
    .sort((a, b) => (counts.recent[b] ?? 0) - (counts.recent[a] ?? 0))
    .slice(0, 40);
  const lines = champions.map((id, index) => `${index < 3 ? ["🥇", "🥈", "🥉"][index] : "🎯"} <@${discordIds.get(id)}> — ${counts.recent[id] ?? 0} (8 wk)`);
  const response = await (dependencies.fetcher ?? fetch)(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...webhookLook(),
      content: shoutoutMessage(lines, `${appUrl()}/snipes`),
      // Mention only the thanked members.
      allowed_mentions: { parse: [], users: champions.map((id) => discordIds.get(id)) },
    }),
  });
  if (!response.ok) throw new ApiError(502, "Discord did not accept the snipe thank-you.", "SHOUTOUT_FAILED");
  return { posted: true, members: champions.length };
}

/** #the-dictators-den, where leadership gets its reminders. */
const LEADERSHIP_CHANNEL_ID = "1504758222974746645";
const DAY = 86_400_000;

/**
 * Jobs the bot reminds leadership about, in the order they appear in a reminder:
 * - warday: today's clan war screenshot (Days 1–5, before the day ends at 00:00 UTC)
 * - clanDays: pick the clan days (Monday, before the next war's Day 1 starts on Tuesday 00:00 UTC)
 * - war: the end-of-war screenshots (Monday, Day 7)
 * - vials: the clan tech donation list (Sunday; the race resets Monday 00:00 UTC)
 */
export const LEADERSHIP_TASKS = ["warday", "clanDays", "war", "vials"] as const;
export type LeadershipTask = (typeof LEADERSHIP_TASKS)[number];

export interface LeadershipDue {
  tasks: LeadershipTask[];
  /** The war day (1–5) that still needs its daily upload, and when that day ends. */
  warDay?: { day: number; endsAt: Date };
  /** On Day 7 the clan days are for the war that starts the next day (as on War → This Week). */
  nextWar: boolean;
  /** Members' votes for that war's days (index 0 = Day 1), when the clan days still need picking. */
  votes?: number[];
}

/**
 * Which jobs are still undone. Vials belong to the Monday–Monday race week; war results and daily
 * points belong to the war that runs Tuesday to Monday (its week is the Monday before Day 1).
 */
export async function leadershipDue(db: Database, now = new Date(), tasks: readonly LeadershipTask[] = ["war", "vials"]): Promise<LeadershipDue> {
  const today = warDay(now);
  const due: LeadershipDue = { tasks: [], nextWar: today.day === 7 };
  for (const task of LEADERSHIP_TASKS.filter((item) => tasks.includes(item))) {
    if (task === "warday") {
      if (today.day > 5) continue; // Day 6 is the battle and Day 7 is for claiming: no daily points.
      const rows = await db.query("SELECT 1 FROM war_results WHERE week_start = $1 AND kind = 'warday' AND war_day = $2 LIMIT 1", [warWeekOf(now), today.day]);
      if (!rows.length) { due.tasks.push(task); due.warDay = { day: today.day, endsAt: today.nextDay }; }
    } else if (task === "clanDays") {
      const week = warWeekOf(due.nextWar ? new Date(now.getTime() + DAY) : now);
      if (!(await clanDays(db, week)).length) {
        due.tasks.push(task);
        due.votes = (await voteCounts(db, week)).counts;
      }
    } else {
      const week = task === "war" ? warWeekOf(now) : currentWeek(now);
      const rows = await db.query("SELECT 1 FROM war_results WHERE week_start = $1 AND kind = $2 LIMIT 1", [week, task]);
      if (!rows.length) due.tasks.push(task);
    }
  }
  return due;
}

/** Clan Hub admins (the people who can do these jobs), leaving out anyone on holiday. */
export async function leadershipPings(db: Database, now = new Date()): Promise<string[]> {
  const rows = await db.query(
    `SELECT discord_id FROM app_members
     WHERE role = 'ADMIN' AND active = TRUE AND (holiday_until IS NULL OR holiday_until < $1::date)
     ORDER BY LOWER(COALESCE(NULLIF(display_name, ''), username))`,
    [now.toISOString().slice(0, 10)],
  );
  return rows.map((row) => String(row.discord_id)).filter((id) => /^\d+$/.test(id)).slice(0, 50);
}

/** English only, like every automatic post: the server's translation bot does the rest. */
export function leadershipReminderMessage(due: LeadershipDue, base: string, mentions: string[] = []): string {
  const blocks = due.tasks.map((task) => {
    if (task === "warday" && due.warDay) {
      const { day, endsAt } = due.warDay;
      return [
        `📸 **Day ${day} war points**: add today's clan war screenshot before Day ${day} ends at 00:00 UTC (<t:${Math.floor(endsAt.getTime() / 1000)}:R>) → ${base}/war-results`,
        `Under **Daily war points**, tap **Day ${day}**, add the screenshot, then **Read screenshots** → **Save daily points**.`,
      ];
    }
    if (task === "clanDays") {
      const voted = (due.votes ?? []).map((count, index) => ({ day: index + 1, count })).filter((item) => item.count > 0)
        .sort((a, b) => b.count - a.count || a.day - b.day);
      const how = voted.length ? `Members voted for: ${voted.map((item) => `Day ${item.day} (${item.count})`).join(", ")}.` : "Tap the days the clan will spend on.";
      return due.nextWar
        ? [`🗓️ **Clan days for the next war**: pick them before Day 1 starts (Tuesday 00:00 UTC) → ${base}/war`, how]
        : [`🗓️ **Clan days this war**: pick them so members know when to spend → ${base}/war`, how];
    }
    if (task === "war") {
      return [
        `🏆 **Clan war results**: add the end-of-war screenshots (clan total + member list) before they reset → ${base}/war-results`,
        "Press **Add**, add the screenshots, then **Read screenshots** → check → **Save**.",
      ];
    }
    return [
      `🧪 **Clan tech vial donations**: add the member list screenshots before the race resets (Monday 00:00 UTC) → ${base}/vial-donations`,
      "Press **Add**, add the screenshots, then **Read screenshots** → check → **Save**.",
    ];
  });
  return ["📌 **Leadership reminder**", ...(mentions.length ? [mentions.join(" ")] : []), ...blocks.flatMap((lines) => ["", ...lines])].join("\n");
}

/**
 * Posts in the leadership channel with the site's bot, only when a job is undone, and pings the
 * Clan Hub admins. Times are in vercel.json: daily points Tuesday–Saturday 21:00 UTC (Days 1–5),
 * war results and clan days Monday 10:00 UTC, vials Sunday 10:00 UTC.
 */
export async function sendLeadershipReminder(dependencies: { db?: Database; fetcher?: typeof fetch; now?: Date; tasks?: readonly LeadershipTask[] } = {}): Promise<{ posted: boolean; missing: LeadershipTask[]; pinged: number }> {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) throw new ApiError(503, "Set DISCORD_BOT_TOKEN so the bot can post reminders.", "REMINDER_NOT_CONFIGURED");
  const db = dependencies.db ?? await database();
  const now = dependencies.now ?? new Date();
  const due = await leadershipDue(db, now, dependencies.tasks);
  if (!due.tasks.length) return { posted: false, missing: [], pinged: 0 };
  const pings = await leadershipPings(db, now);
  const channel = process.env.DISCORD_LEADERSHIP_CHANNEL_ID || LEADERSHIP_CHANNEL_ID;
  const response = await (dependencies.fetcher ?? fetch)(`https://discord.com/api/v10/channels/${channel}/messages`, {
    method: "POST",
    headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
    // Ping only the listed admins (never @everyone or roles); flags 4 = no link previews.
    body: JSON.stringify({
      content: leadershipReminderMessage(due, appUrl(), pings.map((id) => `<@${id}>`)),
      allowed_mentions: { parse: [], users: pings },
      flags: 4,
    }),
  });
  if (!response.ok) throw new ApiError(502, "Discord did not accept the leadership reminder.", "REMINDER_FAILED");
  return { posted: true, missing: due.tasks, pinged: pings.length };
}
