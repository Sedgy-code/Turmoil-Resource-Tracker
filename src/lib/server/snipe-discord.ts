import { randomUUID } from "node:crypto";
import { CHECKIN_CLOSES_AFTER_MS } from "../snipe-calendar";
import type { Member, WarActivity } from "../types";
import { WAR_ACTIVITIES } from "../war";
import { appUrl, guildId, isDemo } from "./config";
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

/** How often a leader opening Snipes re-checks that everyone who said Yes has the role. */
const ROLE_CATCH_UP_MS = 10 * 60_000;
let lastRoleCatchUp = 0;

/**
 * Everyone who said Yes or Maybe to a snipe that's still to come (or on now) gets the Snipe Group role, in case
 * they answered before the bot handed it out or Discord didn't take it then. Runs when a leader opens
 * Snipes, at most every 10 minutes. Never throws: the page loads either way.
 */
export async function catchUpSnipeRoles(dependencies: { db?: Database; fetcher?: typeof fetch; now?: Date } = {}): Promise<{ given: number; failed: number } | null> {
  const now = dependencies.now ?? new Date();
  if (isDemo() || !process.env.DISCORD_BOT_TOKEN || !guildId() || now.getTime() - lastRoleCatchUp < ROLE_CATCH_UP_MS) return null;
  lastRoleCatchUp = now.getTime();
  try {
    const connection = dependencies.db ?? await database();
    const rows = await connection.query(`SELECT DISTINCT m.discord_id FROM snipe_responses r
      JOIN snipe_plans p ON p.id = r.snipe_id JOIN app_members m ON m.id = r.member_id
      WHERE r.answer IN ('yes', 'maybe') AND m.active = TRUE AND p.archived = FALSE AND p.starts_at > $1`,
    [new Date(now.getTime() - CHECKIN_CLOSES_AFTER_MS).toISOString()]);
    return await giveSnipeRole(rows.map((row) => String(row.discord_id)), dependencies.fetcher ?? fetch);
  } catch {
    return null;
  }
}

/** Stops a name or title from turning into Discord formatting. */
const plain = (text: string) => text.replace(/([\\*_~`|>])/g, "\\$1");

/**
 * The call in #snipe-chat (English only, like every Discord post): when, who, and a Check in button.
 * Everyone who said Yes is pinged, then everyone who said Maybe on a line of their own.
 */
export function assembleMessages(snipe: { id: string; title: string; startsAt: string }, leader: string, discordIds: string[], now = new Date(), maybeIds: string[] = []) {
  const start = new Date(snipe.startsAt);
  const unix = Math.floor(start.getTime() / 1000);
  // The clock time in UTC, plus Discord's own "in 12 minutes" for every reader.
  const when = `${start.getTime() > now.getTime() ? "Starts" : "Started"} at ${start.toISOString().slice(11, 16)} UTC (<t:${unix}:R>)`;
  const everyone = [...discordIds.map((id) => ({ id, maybe: false })), ...maybeIds.map((id) => ({ id, maybe: true }))];
  const posts: { content: string; allowed_mentions: { parse: never[]; users: string[] }; components?: unknown[] }[] = [];
  for (let first = 0; first < everyone.length; first += MENTIONS_PER_POST) {
    const chunk = everyone.slice(first, first + MENTIONS_PER_POST);
    const users = chunk.map(({ id }) => id);
    const yes = chunk.filter(({ maybe }) => !maybe).map(({ id }) => `<@${id}>`).join(" ");
    const maybe = chunk.filter(({ maybe }) => maybe).map(({ id }) => `<@${id}>`).join(" ");
    const mentions = [yes, maybe ? `**Maybe:** ${maybe}, join if you can!` : ""].filter(Boolean);
    // Only the listed members are pinged: never @everyone or a role.
    const allowed = { parse: [] as never[], users };
    posts.push(first === 0
      ? {
        content: [
          `🎯 **Snipers, assemble! ${plain(snipe.title)}**`,
          `${when}. Called by ${plain(leader)}.`,
          ...mentions,
          "",
          "Press **Check in** when you join the snipe (+10 Clan Points, once a week).",
        ].join("\n"),
        allowed_mentions: allowed,
        components: [{ type: 1, components: [{ type: 2, style: 3, label: "Check in", emoji: { name: "✅" }, custom_id: `checkin:${snipe.id}` }] }],
      }
      : { content: mentions.join("\n"), allowed_mentions: allowed });
  }
  return posts;
}

/** "Wed 21 Oct, 23:30 UTC": Discord posts are English and clan times are UTC. */
function utcLabel(iso: string): string {
  return `${new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(new Date(iso))}, ${new Date(iso).toISOString().slice(11, 16)} UTC`;
}

/** The Hub's gold, so posts look like the app; grey once a snipe is called off. */
const SNIPE_GOLD = 0xe6bd59;
const SNIPE_GREY = 0x80848e;

export interface SnipePostPlan { title: string; startsAt: string; activities: readonly WarActivity[]; cancelled: boolean }

/**
 * The post in #snipe-chat when a leader plans a snipe: when (UTC, plus Discord's own countdown), what,
 * and who planned it, with a button to answer on the Hub. English only, and it never pings anyone.
 * Once the snipe is called off, the same post says so (grey, no button).
 */
export function snipePlanMessage(plan: SnipePostPlan, leader: string, hub: string) {
  const unix = Math.floor(new Date(plan.startsAt).getTime() / 1000);
  const what = plan.activities.map((key) => WAR_ACTIVITIES.find((activity) => activity.key === key)?.label ?? key).join(", ");
  const link = `${hub}/snipes`;
  return {
    content: plan.cancelled
      ? "❌ This snipe was called off. No need to join."
      : "🎯 A new snipe is planned. Say **Yes**, **Maybe** or **No** on the Clan Hub so leaders know who's in.",
    embeds: [{
      color: plan.cancelled ? SNIPE_GREY : SNIPE_GOLD,
      author: { name: "Turmoil Clan Hub", icon_url: `${hub}/app-icons/icon-192.png`, url: link },
      title: `${plan.cancelled ? "❌ Cancelled: " : "🎯 New snipe: "}${plan.title}`.slice(0, 256),
      url: link,
      description: [
        `**When:** ${utcLabel(plan.startsAt)} (<t:${unix}:R>)`,
        ...(what ? [`**What:** ${what}`] : []),
        `**Planned by:** ${plain(leader)}`,
      ].join("\n"),
      footer: { text: plan.cancelled ? "Called off by a leader." : "Snipers are pinged here when it's time." },
    }],
    // A link button (style 5) needs nothing from the bot when tapped.
    components: plan.cancelled ? [] : [{ type: 1, components: [{ type: 2, style: 5, label: "Answer on the Clan Hub", url: link }] }],
    allowed_mentions: { parse: [] as never[] },
  };
}

/** A snipe as its post shows it, with who planned it and the post's id (if it was posted). */
async function snipeForPost(connection: SqlConnection, snipeId: string): Promise<{ plan: SnipePostPlan; leader: string; messageId: string | null } | null> {
  const rows = await connection.query(`SELECT p.title, p.starts_at, p.activities, p.cancelled_at, p.discord_message_id, m.username
    FROM snipe_plans p JOIN app_members m ON m.id = p.created_by WHERE p.id = $1`, [snipeId]);
  if (!rows.length) return null;
  const activities = typeof rows[0].activities === "string" ? JSON.parse(String(rows[0].activities)) : rows[0].activities;
  return {
    plan: { title: String(rows[0].title), startsAt: iso(rows[0].starts_at)!, activities: Array.isArray(activities) ? activities : [], cancelled: !!rows[0].cancelled_at },
    leader: String(rows[0].username),
    messageId: rows[0].discord_message_id ? String(rows[0].discord_message_id) : null,
  };
}

/**
 * A leader planned a snipe: it goes up in #snipe-chat (no pings), and the post's id is kept so the post
 * follows later changes. True when it went up. Never throws: the snipe stands either way.
 */
export async function postSnipePlan(snipeId: string, dependencies: { db?: Database; fetcher?: typeof fetch } = {}): Promise<boolean> {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (isDemo() || !token) return false;
  try {
    const connection = dependencies.db ?? await database();
    const found = await snipeForPost(connection, snipeId);
    if (!found || found.messageId) return false;
    const channel = process.env.DISCORD_SNIPE_CHANNEL_ID || SNIPE_CHANNEL_ID;
    const sent = await (dependencies.fetcher ?? fetch)(`${DISCORD_API}/channels/${channel}/messages`, {
      method: "POST",
      headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(snipePlanMessage(found.plan, found.leader, appUrl())),
    });
    if (!sent.ok) {
      console.warn("New snipe not posted", sent.status, (await sent.text().catch(() => "")).slice(0, 200));
      return false;
    }
    const posted = (await sent.json().catch(() => ({}))) as { id?: unknown };
    if (posted.id) await connection.query("UPDATE snipe_plans SET discord_message_id = $2 WHERE id = $1", [snipeId, String(posted.id)]);
    return true;
  } catch (error) {
    console.warn("New snipe not posted", error);
    return false;
  }
}

/**
 * The snipe's post shows the snipe as it is now: after a leader changes the time, title or what's
 * included, calls it off, or reopens it. Edits never ping. Never throws.
 */
export async function refreshSnipePost(snipeId: string, dependencies: { db?: Database; fetcher?: typeof fetch } = {}): Promise<boolean> {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (isDemo() || !token) return false;
  try {
    const connection = dependencies.db ?? await database();
    const found = await snipeForPost(connection, snipeId);
    if (!found?.messageId) return false;
    const channel = process.env.DISCORD_SNIPE_CHANNEL_ID || SNIPE_CHANNEL_ID;
    const sent = await (dependencies.fetcher ?? fetch)(`${DISCORD_API}/channels/${channel}/messages/${found.messageId}`, {
      method: "PATCH",
      headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(snipePlanMessage(found.plan, found.leader, appUrl())),
    });
    if (!sent.ok) console.warn("Snipe post not updated", sent.status, (await sent.text().catch(() => "")).slice(0, 200));
    return sent.ok;
  } catch (error) {
    console.warn("Snipe post not updated", error);
    return false;
  }
}

/** Tells everyone who said Yes or Maybe that the snipe is off (English only, like every Discord post). */
export function cancelMessages(snipe: { title: string; startsAt: string }, leader: string, discordIds: string[]) {
  const posts: { content: string; allowed_mentions: { parse: never[]; users: string[] } }[] = [];
  for (let first = 0; first < discordIds.length; first += MENTIONS_PER_POST) {
    const users = discordIds.slice(first, first + MENTIONS_PER_POST);
    const mentions = users.map((id) => `<@${id}>`).join(" ");
    posts.push({
      content: first === 0
        ? [`❌ **Snipe cancelled: ${plain(snipe.title)}** (${utcLabel(snipe.startsAt)})`, `No need to join. Called off by ${plain(leader)}. Thanks for being ready!`, mentions].join("\n")
        : mentions,
      allowed_mentions: { parse: [] as never[], users },
    });
  }
  return posts;
}

/**
 * Posts the cancellation in #snipe-chat, pinging everyone who said Yes or Maybe. True when it was posted
 * (nothing is sent in the demo); false if Discord didn't take it. The cancel stands either way.
 */
export async function tellSnipersCancelled(snipe: { title: string; startsAt: string }, leader: string, discordIds: string[], fetcher: typeof fetch = fetch): Promise<boolean> {
  const ids = discordIds.filter((id) => DISCORD_ID.test(id));
  if (isDemo()) return true;
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token || !guildId() || !ids.length) return false;
  const channel = process.env.DISCORD_SNIPE_CHANNEL_ID || SNIPE_CHANNEL_ID;
  const headers = { Authorization: `Bot ${token}`, "Content-Type": "application/json" };
  let posted = false;
  for (const post of cancelMessages(snipe, leader, ids)) {
    const sent = await fetcher(`${DISCORD_API}/channels/${channel}/messages`, { method: "POST", headers, body: JSON.stringify(post) }).catch(() => null);
    if (!sent?.ok) {
      console.warn("Snipe cancel not posted", sent?.status, sent ? (await sent.text().catch(() => "")).slice(0, 200) : "no answer");
      break;
    }
    posted = true;
  }
  return posted;
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
  /** Members who said Yes or Maybe but couldn't be given the Snipe Group role (so may not see the channel). */
  roleFailed: number;
}

/**
 * A leader calls everyone who said Yes (and, on a line of their own, everyone who said Maybe): the bot
 * makes sure they have the Snipe Group role, then posts in #snipe-chat mentioning each of them, with a
 * Check in button. Until check-in closes, at most every 10 minutes.
 */
export async function assembleSnipers(actor: Member, snipeId: string, dependencies: { db?: Database; fetcher?: typeof fetch; now?: Date } = {}): Promise<SnipeCall> {
  const connection = dependencies.db ?? await database();
  const now = dependencies.now ?? new Date();
  const fetcher = dependencies.fetcher ?? fetch;
  const token = process.env.DISCORD_BOT_TOKEN;
  const live = !isDemo();
  // Who to call. The lock is let go before Discord is asked for anything.
  const { leader, plan, snipers, maybes } = await connection.transaction(async (tx) => {
    await lockAdministration(tx, connection.dialect);
    const leader = await requireAdmin(tx, actor.id);
    const rows = await tx.query("SELECT id, title, starts_at, archived, cancelled_at FROM snipe_plans WHERE id = $1", [snipeId]);
    if (!rows.length) throw new ApiError(404, "This snipe plan could not be found.", "SNIPE_NOT_FOUND");
    if (rows[0].cancelled_at) throw new ApiError(409, "This snipe was cancelled.", "SNIPE_CANCELLED");
    if (rows[0].archived === true) throw new ApiError(409, "This snipe is archived and cannot be changed.", "SNIPE_ARCHIVED");
    const plan = { id: String(rows[0].id), title: String(rows[0].title), startsAt: iso(rows[0].starts_at)! };
    if (now.getTime() > new Date(plan.startsAt).getTime() + CHECKIN_CLOSES_AFTER_MS) {
      throw new ApiError(409, "This snipe is over, so the snipers can’t be called.", "ASSEMBLE_OVER");
    }
    await requireNotRecent(tx, snipeId, now);
    const answered = async (answer: "yes" | "maybe") => (await tx.query(`SELECT m.* FROM snipe_responses r JOIN app_members m ON m.id = r.member_id
      WHERE r.snipe_id = $1 AND r.answer = $2 AND m.active = TRUE`, [snipeId, answer])).map(memberFromRow)
      .sort((a, b) => a.username.localeCompare(b.username, undefined, { sensitivity: "base" }));
    const snipers = await answered("yes");
    const maybes = await answered("maybe");
    const called = [...snipers, ...maybes];
    if (!called.length || (live && !called.some((member) => DISCORD_ID.test(member.discordId)))) {
      throw new ApiError(409, "Nobody has said Yes or Maybe to this snipe yet.", "ASSEMBLE_NOBODY");
    }
    return { leader, plan, snipers, maybes };
  });
  if (live && (!token || !guildId())) throw new ApiError(503, "Discord isn’t set up for snipe calls yet.", "ASSEMBLE_NOT_CONFIGURED");
  const ids = snipers.map((member) => member.discordId).filter((id) => DISCORD_ID.test(id));
  const maybeIds = maybes.map((member) => member.discordId).filter((id) => DISCORD_ID.test(id));
  // Without the role they can't see #snipe-chat, and the ping never reaches them.
  const roles = live ? await giveSnipeRole([...ids, ...maybeIds], fetcher) : { given: 0, failed: 0 };
  return connection.transaction(async (tx) => {
    await lockAdministration(tx, connection.dialect);
    // Another leader may have called them while the roles were handed out.
    await requireNotRecent(tx, snipeId, now);
    let pinged = live ? 0 : snipers.length + maybes.length;
    if (live) {
      const channel = process.env.DISCORD_SNIPE_CHANNEL_ID || SNIPE_CHANNEL_ID;
      const headers = { Authorization: `Bot ${token}`, "Content-Type": "application/json" };
      for (const post of assembleMessages(plan, leader.username, ids, now, maybeIds)) {
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
