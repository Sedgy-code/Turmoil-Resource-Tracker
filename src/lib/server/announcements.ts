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
});

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

/**
 * Admins only: posts a message in one of the clan server's channels as the site's bot.
 * Mentions are switched off so a post can never ping @everyone, and link previews are hidden.
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
  const postable = await postableChannels(fetcher, token, guild);
  const wanted = channelWords(input.channel);
  const matches = postable.filter((channel) => channel.id === input.channel || channelWords(channel.name) === wanted);
  if (matches.length !== 1)
    throw new ApiError(
      404,
      `No single channel called “${input.channel}”. Channels the bot can see: ${postable.map((channel) => channel.name).join(", ")}`,
      "CHANNEL_NOT_FOUND",
    );

  const target = matches[0];
  const embeds = (input.embeds ?? []).map((embed) => ({
    color: EMBED_COLOR,
    title: embed.title,
    ...(embed.description ? { description: embed.description } : {}),
    ...(embed.image ? { image: { url: embed.image } } : {}),
  }));
  const base = {
    content: input.content,
    allowed_mentions: { parse: [] },
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
  const webhook = process.env.DISCORD_REMINDER_WEBHOOK_URL;
  if (webhook && WEBHOOK_URL.test(webhook)) {
    const info = await fetcher(webhook);
    const hook = info.ok ? ((await info.json()) as { channel_id?: unknown }) : null;
    if (hook?.channel_id === target.id) {
      // A plain webhook can't send buttons, so the post goes without one.
      const sent = await fetcher(`${webhook}?wait=true`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(base) });
      if (sent.ok) return { channel: target.name, messageId: await messageId(sent), via: "webhook" };
    }
  }
  throw new ApiError(502, `Discord did not accept the post (${reason}). The bot needs permission to send messages in #${target.name}.`, "ANNOUNCE_FAILED");
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
