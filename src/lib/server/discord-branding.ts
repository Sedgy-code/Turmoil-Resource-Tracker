import { appUrl, guildId } from "./config";
import { ApiError } from "./errors";

const DISCORD_API = "https://discord.com/api/v10";
/** Same name and crest as the clan's MEE6 "Turmoil" bot, so every bot post looks the same. */
export const BOT_NAME = "Turmoil";
export const BOT_AVATAR_PATH = "/app-icons/icon-maskable-512.png";

/** Name and picture for posts sent through a webhook, which would otherwise show the webhook's own name and a blank icon. */
export function webhookLook(): { username: string; avatar_url: string } {
  return { username: BOT_NAME, avatar_url: `${appUrl()}${BOT_AVATAR_PATH}` };
}

export interface BrandingResult {
  nickname: boolean;
  username: boolean;
  avatar: boolean;
  problems: string[];
}

async function reason(response: Response | null): Promise<string> {
  if (!response) return "no answer from Discord";
  const body = (await response.json().catch(() => null)) as { message?: unknown } | null;
  return typeof body?.message === "string" ? body.message : `HTTP ${response.status}`;
}

/**
 * Gives the site's bot the Turmoil name and crest: its nickname in the clan server, plus its own
 * username and picture (so DMs to applicants match too). Each part is tried on its own.
 */
export async function brandBot(fetcher: typeof fetch = fetch): Promise<BrandingResult> {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token || !guildId()) throw new ApiError(503, "Set DISCORD_BOT_TOKEN and DISCORD_GUILD_ID first.", "BRANDING_NOT_CONFIGURED");
  const headers = { Authorization: `Bot ${token}`, "Content-Type": "application/json" };
  const problems: string[] = [];

  const nick = await fetcher(`${DISCORD_API}/guilds/${encodeURIComponent(guildId())}/members/@me`, {
    method: "PATCH", headers, body: JSON.stringify({ nick: BOT_NAME }),
  }).catch(() => null);
  if (!nick?.ok) problems.push(`nickname: ${await reason(nick)}`);

  const image = await fetcher(`${appUrl()}${BOT_AVATAR_PATH}`).catch(() => null);
  let avatar: string | undefined;
  if (image?.ok) avatar = `data:image/png;base64,${Buffer.from(await image.arrayBuffer()).toString("base64")}`;
  else problems.push("picture: the crest image could not be loaded");

  const profile = await fetcher(`${DISCORD_API}/users/@me`, {
    method: "PATCH", headers, body: JSON.stringify(avatar ? { username: BOT_NAME, avatar } : { username: BOT_NAME }),
  }).catch(() => null);
  if (!profile?.ok) problems.push(`username and picture: ${await reason(profile)}`);

  return { nickname: Boolean(nick?.ok), username: Boolean(profile?.ok), avatar: Boolean(profile?.ok && avatar), problems };
}
