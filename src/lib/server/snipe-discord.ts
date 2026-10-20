import { randomUUID } from "node:crypto";
import { CHECKIN_CLOSES_AFTER_MS } from "../snipe-calendar";
import type { Member } from "../types";
import { guildId, isDemo } from "./config";
import { database, lockAdministration, type Database, type SqlConnection } from "./db";
import { fetchGuildMembers } from "./discord-sync";
import { ApiError } from "./errors";
import { requireAdmin } from "./leadership";
import { iso, memberFromRow } from "./mappers";
import { lastAssembly } from "./planning";

const DISCORD_API = "https://discord.com/api/v10";
/** #🔫-snipe-chat in the Turmoil server (DISCORD_SNIPE_CHANNEL_ID overrides it). */
export const SNIPE_CHANNEL_ID = "1505158084627136583";
/** The role that lets members see #snipe-chat (DISCORD_SNIPE_ROLE_ID or DISCORD_SNIPE_ROLE_NAME override it). */
export const SNIPE_ROLE_NAME = "Snipe Group";
/** A snipe's snipers can be called this often, so a double tap or two leaders never ping twice. */
export const ASSEMBLE_EVERY_MS = 10 * 60_000;
/** Discord messages are capped at 2,000 characters: 40 mentions per post. */
const MENTIONS_PER_POST = 40;
const DISCORD_ID = /^\d{1,25}$/;

/** The Snipe Group role: set directly, found by its name, or else the one role with "snipe" in its name. */
export async function snipeRoleId(token: string, fetcher: typeof fetch): Promise<string | null> {
  if (process.env.DISCORD_SNIPE_ROLE_ID) return process.env.DISCORD_SNIPE_ROLE_ID;
  const response = await fetcher(`${DISCORD_API}/guilds/${encodeURIComponent(guildId())}/roles`, { headers: { Authorization: `Bot ${token}` } }).catch(() => null);
  if (!response?.ok) return null;
  const roles = (await response.json().catch(() => null)) as { id?: unknown; name?: unknown }[] | null;
  if (!Array.isArray(roles)) return null;
  const name = (role: { name?: unknown }) => String(role?.name ?? "").trim().toLowerCase();
  const wanted = (process.env.DISCORD_SNIPE_ROLE_NAME || SNIPE_ROLE_NAME).trim().toLowerCase();
  const exact = roles.find((role) => name(role) === wanted);
  if (exact) return String(exact.id);
  const snipe = roles.filter((role) => name(role).includes("snipe"));
  return snipe.length === 1 ? String(snipe[0].id) : null;
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** One role grant. If Discord asks the bot to slow down, it waits (up to 3 seconds) and tries once more. */
async function addRole(discordId: string, role: string, token: string, fetcher: typeof fetch): Promise<boolean> {
  const url = `${DISCORD_API}/guilds/${encodeURIComponent(guildId())}/members/${discordId}/roles/${role}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetcher(url, { method: "PUT", headers: { Authorization: `Bot ${token}`, "X-Audit-Log-Reason": "Said Yes to a snipe on the Clan Hub" } }).catch(() => null);
    if (response?.ok) return true;
    if (response?.status !== 429 || attempt) return false;
    const body = (await response.json().catch(() => ({}))) as { retry_after?: unknown };
    await pause(Math.min(3, Math.max(0, Number(body.retry_after) || 1)) * 1000);
  }
  return false;
}

/**
 * Gives members the Snipe Group role so they can see #snipe-chat (it's never taken away here).
 * For several members the server is read once and only those without the role get it.
 * Nothing is sent in the demo or before Discord is set up.
 */
export async function giveSnipeRole(discordIds: string[], fetcher: typeof fetch = fetch): Promise<{ given: number; failed: number }> {
  const token = process.env.DISCORD_BOT_TOKEN;
  const ids = [...new Set(discordIds.filter((id) => DISCORD_ID.test(id)))];
  if (isDemo() || !token || !guildId() || !ids.length) return { given: 0, failed: 0 };
  const role = await snipeRoleId(token, fetcher);
  if (!role) {
    console.warn("Snipe Group role not found: set DISCORD_SNIPE_ROLE_ID");
    return { given: 0, failed: ids.length };
  }
  let missing = ids;
  if (ids.length > 1) {
    const members = await fetchGuildMembers(token, fetcher).catch(() => null);
    if (members) {
      const hasRole = new Set(members.filter((member) => member.roles?.includes(role)).map((member) => member.user?.id));
      missing = ids.filter((id) => !hasRole.has(id));
    }
  }
  let given = 0;
  for (const id of missing) if (await addRole(id, role, token, fetcher)) given++;
  if (given < missing.length) console.warn(`Snipe Group role: ${missing.length - given} of ${missing.length} not given`);
  return { given, failed: missing.length - given };
}

/** Stops a name or title from turning into Discord formatting. */
const plain = (text: string) => text.replace(/([\\*_~`|>])/g, "\\$1");

/** The call in #snipe-chat (English only, like every Discord post): when, who, and a Check in button. */
export function assembleMessages(snipe: { id: string; title: string; startsAt: string }, leader: string, discordIds: string[], now = new Date()) {
  const start = new Date(snipe.startsAt);
  const unix = Math.floor(start.getTime() / 1000);
  // The clock time in UTC, plus Discord's own "in 12 minutes" for every reader.
  const when = `${start.getTime() > now.getTime() ? "Starts" : "Started"} at ${start.toISOString().slice(11, 16)} UTC (<t:${unix}:R>)`;
  const posts: { content: string; allowed_mentions: { parse: never[]; users: string[] }; components?: unknown[] }[] = [];
  for (let first = 0; first < discordIds.length; first += MENTIONS_PER_POST) {
    const users = discordIds.slice(first, first + MENTIONS_PER_POST);
    const mentions = users.map((id) => `<@${id}>`).join(" ");
    // Only the listed members are pinged: never @everyone or a role.
    const allowed = { parse: [] as never[], users };
    posts.push(first === 0
      ? {
        content: [
          `🎯 **Snipers, assemble! ${plain(snipe.title)}**`,
          `${when}. Called by ${plain(leader)}.`,
          mentions,
          "",
          "Press **Check in** when you join the snipe (+10 Clan Points, once a week).",
        ].join("\n"),
        allowed_mentions: allowed,
        components: [{ type: 1, components: [{ type: 2, style: 3, label: "Check in", emoji: { name: "✅" }, custom_id: `checkin:${snipe.id}` }] }],
      }
      : { content: mentions, allowed_mentions: allowed });
  }
  return posts;
}

async function requireNotRecent(connection: SqlConnection, snipeId: string, now: Date): Promise<void> {
  const last = await lastAssembly(connection, snipeId);
  if (last && now.getTime() - new Date(last.at).getTime() < ASSEMBLE_EVERY_MS) {
    throw new ApiError(409, "The snipers were already called in the last 10 minutes.", "ASSEMBLE_TOO_SOON");
  }
}

export interface SnipeCall {
  by: string;
  at: string;
  /** Members pinged in #snipe-chat. */
  count: number;
  /** Members who said Yes but couldn't be given the Snipe Group role (so may not see the channel). */
  roleFailed: number;
}

/**
 * A leader calls everyone who said Yes: the bot makes sure they have the Snipe Group role, then posts in
 * #snipe-chat mentioning each of them, with a Check in button. Until check-in closes, at most every 10 minutes.
 */
export async function assembleSnipers(actor: Member, snipeId: string, dependencies: { db?: Database; fetcher?: typeof fetch; now?: Date } = {}): Promise<SnipeCall> {
  const connection = dependencies.db ?? await database();
  const now = dependencies.now ?? new Date();
  const fetcher = dependencies.fetcher ?? fetch;
  const token = process.env.DISCORD_BOT_TOKEN;
  const live = !isDemo();
  // Who to call. The lock is let go before Discord is asked for anything.
  const { leader, plan, snipers } = await connection.transaction(async (tx) => {
    await lockAdministration(tx, connection.dialect);
    const leader = await requireAdmin(tx, actor.id);
    const rows = await tx.query("SELECT id, title, starts_at, archived FROM snipe_plans WHERE id = $1", [snipeId]);
    if (!rows.length) throw new ApiError(404, "This snipe plan could not be found.", "SNIPE_NOT_FOUND");
    if (rows[0].archived === true) throw new ApiError(409, "This snipe is archived and cannot be changed.", "SNIPE_ARCHIVED");
    const plan = { id: String(rows[0].id), title: String(rows[0].title), startsAt: iso(rows[0].starts_at)! };
    if (now.getTime() > new Date(plan.startsAt).getTime() + CHECKIN_CLOSES_AFTER_MS) {
      throw new ApiError(409, "This snipe is over, so the snipers can’t be called.", "ASSEMBLE_OVER");
    }
    await requireNotRecent(tx, snipeId, now);
    const snipers = (await tx.query(`SELECT m.* FROM snipe_responses r JOIN app_members m ON m.id = r.member_id
      WHERE r.snipe_id = $1 AND r.answer = 'yes' AND m.active = TRUE`, [snipeId])).map(memberFromRow)
      .sort((a, b) => a.username.localeCompare(b.username, undefined, { sensitivity: "base" }));
    if (!snipers.length || (live && !snipers.some((member) => DISCORD_ID.test(member.discordId)))) {
      throw new ApiError(409, "Nobody has said Yes to this snipe yet.", "ASSEMBLE_NOBODY");
    }
    return { leader, plan, snipers };
  });
  if (live && (!token || !guildId())) throw new ApiError(503, "Discord isn’t set up for snipe calls yet.", "ASSEMBLE_NOT_CONFIGURED");
  const ids = snipers.map((member) => member.discordId).filter((id) => DISCORD_ID.test(id));
  // Without the role they can't see #snipe-chat, and the ping never reaches them.
  const roles = live ? await giveSnipeRole(ids, fetcher) : { given: 0, failed: 0 };
  return connection.transaction(async (tx) => {
    await lockAdministration(tx, connection.dialect);
    // Another leader may have called them while the roles were handed out.
    await requireNotRecent(tx, snipeId, now);
    let pinged = live ? 0 : snipers.length;
    if (live) {
      const channel = process.env.DISCORD_SNIPE_CHANNEL_ID || SNIPE_CHANNEL_ID;
      const headers = { Authorization: `Bot ${token}`, "Content-Type": "application/json" };
      for (const post of assembleMessages(plan, leader.username, ids, now)) {
        const sent = await fetcher(`${DISCORD_API}/channels/${channel}/messages`, { method: "POST", headers, body: JSON.stringify(post) }).catch(() => null);
        if (!sent?.ok) {
          // Discord's reason (such as "Missing Permissions") never contains secrets.
          console.warn("Snipe call not posted", sent?.status, sent ? (await sent.text().catch(() => "")).slice(0, 200) : "no answer");
          // Nothing reached Discord: nothing is recorded, so it can be tried again straight away.
          if (!pinged) throw new ApiError(502, "The bot couldn’t post in #snipe-chat. It needs permission to send messages there.", "ASSEMBLE_FAILED");
          break;
        }
        pinged += post.allowed_mentions.users.length;
      }
    }
    await tx.query("INSERT INTO snipe_assemblies (id, snipe_id, sent_by, sent_at, member_count) VALUES ($1, $2, $3, $4, $5)",
      [randomUUID(), snipeId, leader.id, now.toISOString(), pinged]);
    return { by: leader.username, at: now.toISOString(), count: pinged, roleFailed: roles.failed };
  });
}
