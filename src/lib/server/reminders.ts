import { currentWeek } from "../resources";
import { appUrl } from "./config";
import { database, type Database } from "./db";
import { ApiError } from "./errors";

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
