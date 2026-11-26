import { randomUUID } from "node:crypto";
import { currentWeek, formatWeek } from "../resources";
import { warDay, warWeekOf } from "../war-calendar";
import { appUrl, isDemo } from "./config";
import { database, lockAdministration, type Database } from "./db";
import { memberWeeks } from "./leader";
import { LEADERSHIP_CHANNEL_ID } from "./reminders";

const DISCORD_API = "https://discord.com/api/v10";
/** The first war week with automatic strikes: the war whose Day 1 is Tuesday 1 December 2026 (leadership's call). */
export const AUTO_STRIKES_FROM = "2026-11-30";

export interface AutoStrikeResult {
  week: string;
  /** Names of the members who got a strike this run. */
  struck: string[];
  /** Why nothing was checked, when nothing was. */
  skipped?: string;
  /** Members the bot couldn't message (closed DMs or Discord down). */
  notMessaged: string[];
  posted: boolean;
}

/** The private message to a member who got an automatic strike. English only, like every Discord post. */
export function autoStrikeMessage(week: string, link: string): string {
  return [
    `⚠️ **Automatic strike**: your resources weren't updated in the Turmoil Clan Hub by the end of War Day 1 (Wednesday 00:00 UTC, war of ${formatWeek(week)}).`,
    `Please save them every week before Day 1 starts (Tuesday 00:00 UTC): ${link}`,
    "If you think this is a mistake, message a leader.",
  ].join("\n");
}

/** The leaders' list, posted silently in the leadership channel. Names only: nobody is pinged. */
export function autoStrikeLeadershipMessage(week: string, names: string[], notMessaged: string[], base: string): string {
  return [
    `⚠️ **Automatic strikes · war of ${formatWeek(week)}**`,
    `${names.length} ${names.length === 1 ? "member hadn't" : "members hadn't"} updated their resources by the end of War Day 1: ${names.join(", ")}`,
    ...(notMessaged.length ? [`Couldn't send a private message to: ${notMessaged.join(", ")}`] : []),
    `Members on holiday were skipped. Remove a strike on the Members page if it was a mistake → ${base}/members`,
  ].join("\n");
}

async function sendPrivateMessage(discordId: string, content: string, fetcher: typeof fetch, token: string): Promise<boolean> {
  if (!/^\d+$/.test(discordId)) return false;
  const headers = { Authorization: `Bot ${token}`, "Content-Type": "application/json" };
  const channel = await fetcher(`${DISCORD_API}/users/@me/channels`, { method: "POST", headers, body: JSON.stringify({ recipient_id: discordId }) }).catch(() => null);
  const channelId = channel?.ok ? String(((await channel.json().catch(() => ({}))) as { id?: unknown }).id ?? "") : "";
  if (!channelId) return false;
  // No pings and no link previews.
  const sent = await fetcher(`${DISCORD_API}/channels/${channelId}/messages`, { method: "POST", headers, body: JSON.stringify({ content, allowed_mentions: { parse: [] }, flags: 4 }) }).catch(() => null);
  return !!sent?.ok;
}

/**
 * After War Day 1 ends (Wednesday 00:00 UTC), every active member who hasn't updated their resources
 * this week gets a strike: the same members as "Not saved" on the Status board. Members on holiday are
 * skipped. At most one automatic strike per member per war, even if this runs again or a leader removes
 * it. Each member gets a private message from the bot, and leadership gets one silent list.
 */
export async function applyAutoStrikes(dependencies: { db?: Database; fetcher?: typeof fetch; now?: Date } = {}): Promise<AutoStrikeResult> {
  const connection = dependencies.db ?? await database();
  const now = dependencies.now ?? new Date();
  const week = warWeekOf(now);
  const result: AutoStrikeResult = { week, struck: [], notMessaged: [], posted: false };
  const { day } = warDay(now);
  // Only between the end of Day 1 and the end of the clan week (Sunday), while the saves still belong to this war.
  if (day < 2 || currentWeek(now) !== week) return { ...result, skipped: "War Day 1 of this war isn't over, or the war's clan week has ended." };
  if (week < AUTO_STRIKES_FROM) return { ...result, skipped: "Automatic strikes start with the war of 30 November 2026." };

  const reason = `Automatic: resources not updated by the end of War Day 1 (war of ${formatWeek(week)})`;
  const struck = await connection.transaction(async (tx) => {
    await lockAdministration(tx, connection.dialect);
    const pending = (await memberWeeks(tx, now)).filter(({ state }) => state === "notStarted");
    const added: { name: string; discordId: string }[] = [];
    for (const { member } of pending) {
      const inserted = await tx.query(`INSERT INTO member_strikes (id, member_id, reason, created_at, created_by, auto_week) VALUES ($1, $2, $3, $4, NULL, $5)
        ON CONFLICT (member_id, auto_week) WHERE auto_week IS NOT NULL DO NOTHING RETURNING id`, [randomUUID(), member.id, reason, now.toISOString(), week]);
      if (inserted.length) added.push({ name: member.username, discordId: member.discordId });
    }
    return added.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  });
  result.struck = struck.map(({ name }) => name);
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!struck.length || !token || isDemo()) return result;

  const fetcher = dependencies.fetcher ?? fetch;
  const base = appUrl();
  for (const member of struck) {
    if (!(await sendPrivateMessage(member.discordId, autoStrikeMessage(week, `${base}/resources`), fetcher, token))) result.notMessaged.push(member.name);
  }
  const channel = process.env.DISCORD_LEADERSHIP_CHANNEL_ID || LEADERSHIP_CHANNEL_ID;
  const posted = await fetcher(`${DISCORD_API}/channels/${channel}/messages`, {
    method: "POST",
    headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
    // No pings (names only), no link previews (4), silent (4096).
    body: JSON.stringify({ content: autoStrikeLeadershipMessage(week, result.struck, result.notMessaged, base), allowed_mentions: { parse: [] }, flags: 4 | 4096 }),
  }).catch(() => null);
  result.posted = !!posted?.ok;
  return result;
}
