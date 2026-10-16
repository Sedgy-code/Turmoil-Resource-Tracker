import { currentWeek } from "../resources";
import { appUrl } from "./config";
import { database, type Database } from "./db";
import { ApiError } from "./errors";
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
     WHERE m.active = TRUE AND NOT EXISTS (
       SELECT 1 FROM dew_weekly_earnings e
       WHERE e.member_id = m.id AND e.week_start = $1::date AND e.reason = 'resources'
     )
     ORDER BY LOWER(COALESCE(NULLIF(m.display_name, ''), m.username))`,
    [week],
  );
  return rows.map((row) => ({ discordId: String(row.discord_id), name: String(row.name) }));
}

/** One short message in all four languages, so nobody needs to translate it. */
export function reminderMessage(mentions: string[], link: string): string {
  return [
    "📋 **Weekly resource update · 每週資源更新 · 每周资源更新 · 주간 자원 업데이트**",
    mentions.join(" "),
    "",
    `🇬🇧 Please save your resources this week (+20 Clan Points): ${link}`,
    `🇹🇼 請在本週儲存你的資源（+20 公會點數）：${link}`,
    `🇨🇳 请在本周保存你的资源（+20 公会点数）：${link}`,
    `🇰🇷 이번 주 자원을 저장해 주세요 (+20 클랜 포인트): ${link}`,
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
        content: reminderMessage(mentions, link),
        // Only ping the listed members, never @everyone or roles.
        allowed_mentions: { parse: [], users: mentions.map((mention) => mention.slice(2, -1)) },
      }),
    });
    if (!response.ok) throw new ApiError(502, "Discord did not accept the reminder.", "REMINDER_FAILED");
  }
  return { week, pending: pending.length, posted: true };
}

/** Thank-you post naming everyone confirmed at a snipe last clan week, with their recent count. */
export function shoutoutMessage(lines: string[], link: string): string {
  return [
    "🎯 **Snipe Champions · 狙擊冠軍 · 狙击冠军 · 스나이프 챔피언**",
    "",
    "🇬🇧 Thank you to everyone who joined last week's snipes!",
    "🇹🇼 感謝上週參加狙擊的每一位！",
    "🇨🇳 感谢上周参加狙击的每一位！",
    "🇰🇷 지난주 스나이프에 참여한 모든 분께 감사드려요!",
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
      content: shoutoutMessage(lines, `${appUrl()}/snipes`),
      // Mention only the thanked members.
      allowed_mentions: { parse: [], users: champions.map((id) => discordIds.get(id)) },
    }),
  });
  if (!response.ok) throw new ApiError(502, "Discord did not accept the snipe thank-you.", "SHOUTOUT_FAILED");
  return { posted: true, members: champions.length };
}

/** #the-dictators-den, where leadership gets the Sunday upload reminder. */
const LEADERSHIP_CHANNEL_ID = "1504758222974746645";

/** Which uploads are still missing for this clan week. */
export async function missingUploads(db: Database, week = currentWeek()): Promise<("war" | "vials")[]> {
  const rows = await db.query("SELECT DISTINCT kind FROM war_results WHERE week_start = $1", [week]);
  const done = new Set(rows.map((row) => String(row.kind)));
  return (["war", "vials"] as const).filter((kind) => !done.has(kind));
}

export function leadershipReminderMessage(missing: ("war" | "vials")[], base: string): string {
  return [
    "📸 **Weekly upload reminder**",
    "Please grab the screenshots before they reset and add them to the Clan Hub:",
    ...missing.map((kind) => kind === "war"
      ? `• 🏆 **Clan war results** (clan total + member list) → ${base}/war-results`
      : `• 🧪 **Clan tech vial donations** (member list) → ${base}/vial-donations`),
    "Press **Add**, add the screenshots, then **Read screenshots** → check → **Save**.",
  ].join("\n");
}

/** Sunday evening: posts in the leadership channel with the site's bot, only if something is missing. */
export async function sendLeadershipReminder(dependencies: { db?: Database; fetcher?: typeof fetch } = {}): Promise<{ posted: boolean; missing: string[] }> {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) throw new ApiError(503, "Set DISCORD_BOT_TOKEN so the bot can post reminders.", "REMINDER_NOT_CONFIGURED");
  const db = dependencies.db ?? await database();
  const missing = await missingUploads(db);
  if (!missing.length) return { posted: false, missing };
  const channel = process.env.DISCORD_LEADERSHIP_CHANNEL_ID || LEADERSHIP_CHANNEL_ID;
  const response = await (dependencies.fetcher ?? fetch)(`https://discord.com/api/v10/channels/${channel}/messages`, {
    method: "POST",
    headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
    // flags 4 = no link previews, so the reminder stays short.
    body: JSON.stringify({ content: leadershipReminderMessage(missing, appUrl()), allowed_mentions: { parse: [] }, flags: 4 }),
  });
  if (!response.ok) throw new ApiError(502, "Discord did not accept the leadership reminder.", "REMINDER_FAILED");
  return { posted: true, missing };
}
