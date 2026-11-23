import { z } from "zod";
import type { Member } from "../types";
import { guildId } from "./config";
import { database, type Database } from "./db";
import { ApiError } from "./errors";

const DISCORD_API = "https://discord.com/api/v10";
/** Text and announcement channels: the ones a plain message can go in. */
const POSTABLE_CHANNEL_TYPES = new Set([0, 5]);

const httpsLink = z.string().trim().max(2000).url().refine((value) => value.startsWith("https://"), "Use an https:// link.");

export const announcementSchema = z.object({
  /** The channel's name as people say it ("turmoil resource tracker"), or its id. */
  channel: z.string().trim().min(1).max(100),
  content: z.string().trim().min(1).max(2000),
  /** Optional cards under the text in the Hub's gold, such as a guide's steps with a screenshot each. */
  embeds: z.array(z.object({
    title: z.string().trim().min(1).max(256),
    description: z.string().trim().max(1500).optional(),
    image: httpsLink.optional(),
  }).strict()).max(4).optional(),
  /** Optional link button under the post, such as "Open the Spending Order". */
  button: z.object({ label: z.string().trim().min(1).max(80), url: httpsLink }).strict().optional(),
  /** Only when a leader asks for it: the post starts with @everyone and pings the whole server. */
  pingEveryone: z.boolean().optional(),
});

/** Admins: take down a post the bot (or the reminder webhook) made, by its channel and message id. */
export const announcementDeleteSchema = z.object({
  channel: z.string().trim().min(1).max(100),
  messageId: z.string().trim().regex(/^\d{5,25}$/, "Use the message's id."),
}).strict();

/** The Hub's gold, so posts look like the app. */
const EMBED_COLOR = 0xe6bd59;

/** Admins: the channels a post can go in, so the right one can be picked before anything is posted. */
export async function announcementChannels(
  actor: Member,
  dependencies: { db?: Database; fetcher?: typeof fetch } = {},
): Promise<{ channels: { id: string; name: string }[] }> {
  const db = dependencies.db ?? await database();
  await requireAdmin(db, actor);
  const { token, guild } = botSetup();
  const channels = await postableChannels(dependencies.fetcher ?? fetch, token, guild);
  return { channels: channels.map((channel) => ({ id: channel.id, name: channel.name })) };
}

async function requireAdmin(db: Database, actor: Member): Promise<void> {
  const rows = await db.query("SELECT role, active FROM app_members WHERE id = $1", [actor.id]);
  if (!rows.length || rows[0].role !== "ADMIN" || rows[0].active !== true)
    throw new ApiError(403, "Only administrators can post as the bot.", "ADMIN_REQUIRED");
}

function botSetup(): { token: string; guild: string } {
  const token = process.env.DISCORD_BOT_TOKEN;
  const guild = guildId();
  if (!token || !guild)
    throw new ApiError(503, "Set DISCORD_BOT_TOKEN and DISCORD_GUILD_ID so the bot can post.", "ANNOUNCE_NOT_CONFIGURED");
  return { token, guild };
}

async function postableChannels(fetcher: typeof fetch, token: string, guild: string): Promise<{ id: string; name: string; type: number }[]> {
  const listed = await fetcher(`${DISCORD_API}/guilds/${encodeURIComponent(guild)}/channels`, { headers: { Authorization: `Bot ${token}` } });
  if (!listed.ok) throw new ApiError(502, "Discord’s channel list could not be read.", "DISCORD_UNAVAILABLE");
  const channels = (await listed.json()) as { id: string; name: string; type: number }[];
  return Array.isArray(channels) ? channels.filter((channel) => POSTABLE_CHANNEL_TYPES.has(channel.type)) : [];
}

/** "📊・turmoil-resource-tracker" and "Turmoil Resource Tracker" both become "turmoil resource tracker". */
export function channelWords(name: string): string {
  return name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();
}

/** The one channel a leader named (by its name as people say it, or its id). */
function pickChannel(postable: { id: string; name: string }[], asked: string): { id: string; name: string } {
  const wanted = channelWords(asked);
  const matches = postable.filter((channel) => channel.id === asked || channelWords(channel.name) === wanted);
  if (matches.length !== 1)
    throw new ApiError(
      404,
      `No single channel called “${asked}”. Channels the bot can see: ${postable.map((channel) => channel.name).join(", ")}`,
      "CHANNEL_NOT_FOUND",
    );
  return matches[0];
}

/** The reminder webhook's URL, when it lives in that channel. */
async function webhookIn(fetcher: typeof fetch, channelId: string): Promise<string | null> {
  const webhook = process.env.DISCORD_REMINDER_WEBHOOK_URL;
  if (!webhook || !WEBHOOK_URL.test(webhook)) return null;
  const info = await fetcher(webhook);
  const hook = info.ok ? ((await info.json()) as { channel_id?: unknown }) : null;
  return hook?.channel_id === channelId ? webhook : null;
}

/**
 * Admins only: posts a message in one of the clan server's channels as the site's bot.
 * Mentions are switched off so a post never pings anyone, unless the leader asks to ping
 * @everyone; link previews are hidden.
 */
export async function postAnnouncement(
  actor: Member,
  input: z.infer<typeof announcementSchema>,
  dependencies: { db?: Database; fetcher?: typeof fetch } = {},
): Promise<{ channel: string; messageId: string; via: "bot" | "webhook" }> {
  const db = dependencies.db ?? await database();
  await requireAdmin(db, actor);
  const { token, guild } = botSetup();
  const fetcher = dependencies.fetcher ?? fetch;
  const headers = { Authorization: `Bot ${token}`, "Content-Type": "application/json" };
  const target = pickChannel(await postableChannels(fetcher, token, guild), input.channel);
  const embeds = (input.embeds ?? []).map((embed) => ({
    color: EMBED_COLOR,
    title: embed.title,
    ...(embed.description ? { description: embed.description } : {}),
    ...(embed.image ? { image: { url: embed.image } } : {}),
  }));
  const everyone = input.pingEveryone === true;
  const base = {
    content: everyone && !input.content.includes("@everyone") ? `@everyone\n${input.content}`.slice(0, 2000) : input.content,
    // Only @everyone, and only when asked: never roles or people.
    allowed_mentions: { parse: everyone ? ["everyone"] : [] },
    // flags 4 = no link previews, so the post stays short. It would hide the post's own cards too, so not with cards.
    ...(embeds.length ? { embeds } : { flags: 4 }),
  };
  // A link button (style 5) needs nothing from the bot when tapped.
  const button = input.button ? { components: [{ type: 1, components: [{ type: 2, style: 5, label: input.button.label, url: input.button.url }] }] } : {};
  const message = JSON.stringify({ ...base, ...button });
  const posted = await fetcher(`${DISCORD_API}/channels/${target.id}/messages`, { method: "POST", headers, body: message });
  if (posted.ok) return { channel: target.name, messageId: await messageId(posted), via: "bot" };
  const reason = await discordReason(posted);

  // The bot may not be allowed to post in that channel, but the weekly reminder's webhook
  // (which posts as the Turmoil bot) may live there. Use it when it does.
  const webhook = await webhookIn(fetcher, target.id);
  if (webhook) {
    // A plain webhook can't send buttons, so the post goes without one.
    const sent = await fetcher(`${webhook}?wait=true`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(base) });
    if (sent.ok) return { channel: target.name, messageId: await messageId(sent), via: "webhook" };
  }
  throw new ApiError(502, `Discord did not accept the post (${reason}). The bot needs permission to send messages in #${target.name}.`, "ANNOUNCE_FAILED");
}

/**
 * Admins only: deletes a post the bot made, or one the reminder webhook made in that channel
 * (each can only delete its own posts). Used to replace an announcement, for example.
 */
export async function deleteAnnouncement(
  actor: Member,
  input: z.infer<typeof announcementDeleteSchema>,
  dependencies: { db?: Database; fetcher?: typeof fetch } = {},
): Promise<{ channel: string; messageId: string; via: "bot" | "webhook" }> {
  const db = dependencies.db ?? await database();
  await requireAdmin(db, actor);
  const { token, guild } = botSetup();
  const fetcher = dependencies.fetcher ?? fetch;
  const target = pickChannel(await postableChannels(fetcher, token, guild), input.channel);
  const deleted = await fetcher(`${DISCORD_API}/channels/${target.id}/messages/${input.messageId}`, {
    method: "DELETE",
    headers: { Authorization: `Bot ${token}`, "X-Audit-Log-Reason": "Replaced by a leader from the Clan Hub" },
  });
  if (deleted.ok) return { channel: target.name, messageId: input.messageId, via: "bot" };
  const reason = await discordReason(deleted);
  const webhook = await webhookIn(fetcher, target.id);
  if (webhook) {
    const removed = await fetcher(`${webhook}/messages/${input.messageId}`, { method: "DELETE" });
    if (removed.ok) return { channel: target.name, messageId: input.messageId, via: "webhook" };
  }
  throw new ApiError(502, `Discord did not delete the post (${reason}).`, "ANNOUNCE_DELETE_FAILED");
}

const WEBHOOK_URL = /^https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\//;

async function messageId(response: Response): Promise<string> {
  const body = (await response.json().catch(() => ({}))) as { id?: unknown };
  return String(body.id ?? "");
}

/** Discord's own reason, such as "Missing Permissions (50013)". It never contains secrets. */
async function discordReason(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { message?: unknown; code?: unknown } | null;
  if (typeof body?.message === "string") return typeof body.code === "number" ? `${body.message}, ${body.code}` : body.message;
  return `HTTP ${response.status}`;
}
