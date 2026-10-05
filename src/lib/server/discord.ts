import { ApiError } from "./errors";
import { appUrl, guildId } from "./config";

const DISCORD_API = "https://discord.com/api/v10";
export interface DiscordUser {
  id: string;
  username: string;
  global_name?: string | null;
  avatar: string | null;
  discriminator: string;
}
export interface DiscordTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
}

async function safeFetch(
  fetcher: typeof fetch,
  url: string,
  options: RequestInit,
): Promise<Response> {
  try {
    return await fetcher(url, options);
  } catch {
    throw new ApiError(
      503,
      "Discord is temporarily unavailable. Please try again.",
      "DISCORD_UNAVAILABLE",
    );
  }
}

async function discordRequest(
  path: string,
  accessToken: string,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  return safeFetch(fetcher, `${DISCORD_API}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
  });
}

export async function exchangeCode(
  code: string,
  verifier: string,
  fetcher: typeof fetch = fetch,
): Promise<DiscordTokens> {
  return tokenRequest(
    {
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      redirect_uri: `${appUrl()}/api/auth/callback`,
    },
    fetcher,
  );
}
export async function refreshTokens(
  refreshToken: string,
  fetcher: typeof fetch = fetch,
): Promise<DiscordTokens> {
  return tokenRequest(
    { grant_type: "refresh_token", refresh_token: refreshToken },
    fetcher,
  );
}
async function tokenRequest(
  values: Record<string, string>,
  fetcher: typeof fetch,
): Promise<DiscordTokens> {
  const response = await safeFetch(fetcher, `${DISCORD_API}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID!,
      client_secret: process.env.DISCORD_CLIENT_SECRET!,
      ...values,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
  });
  if (response.status === 429 || response.status >= 500)
    throw new ApiError(
      503,
      "Discord is temporarily unavailable. Please try again.",
      "DISCORD_UNAVAILABLE",
    );
  if (!response.ok)
    throw new ApiError(
      401,
      "Discord sign-in expired. Please sign in again.",
      "DISCORD_AUTH_FAILED",
    );
  const data = (await response.json()) as DiscordTokens;
  if (
    !data.access_token ||
    !data.refresh_token ||
    !Number.isFinite(data.expires_in) ||
    data.expires_in <= 0
  )
    throw new ApiError(
      401,
      "Discord did not return a valid sign-in.",
      "DISCORD_AUTH_FAILED",
    );
  return data;
}

export async function fetchDiscordUser(
  accessToken: string,
  fetcher: typeof fetch = fetch,
): Promise<DiscordUser> {
  const response = await discordRequest("/users/@me", accessToken, fetcher);
  if (!response.ok)
    throw new ApiError(
      401,
      "Your Discord sign-in could not be verified.",
      "DISCORD_AUTH_FAILED",
    );
  const data = (await response.json()) as DiscordUser;
  if (!/^\d+$/.test(data.id) || !data.username)
    throw new ApiError(
      401,
      "Your Discord identity could not be verified.",
      "DISCORD_AUTH_FAILED",
    );
  return data;
}

export async function assertGuildMembership(
  accessToken: string,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const response = await discordRequest(
    `/users/@me/guilds/${encodeURIComponent(guildId())}/member`,
    accessToken,
    fetcher,
  );
  if (response.status === 404 || response.status === 403)
    throw new ApiError(
      403,
      "You must be a member of the Turmoil Discord server to access the tracker.",
      "GUILD_REQUIRED",
    );
  if (response.status === 401)
    throw new ApiError(
      401,
      "Your Discord session expired. Please sign in again.",
      "DISCORD_AUTH_FAILED",
    );
  if (!response.ok)
    throw new ApiError(
      503,
      "Discord membership verification is temporarily unavailable. Please try again.",
      "DISCORD_UNAVAILABLE",
    );
  const membership = (await response.json()) as { roles?: string[] };
  if (!Array.isArray(membership.roles))
    throw new ApiError(
      503,
      "Discord returned an invalid membership response.",
      "DISCORD_UNAVAILABLE",
    );
  if (
    process.env.DISCORD_ROLE_ID &&
    !membership.roles.includes(process.env.DISCORD_ROLE_ID)
  )
    throw new ApiError(
      403,
      "You need the required Turmoil Discord role to access the tracker.",
      "ROLE_REQUIRED",
    );
}

export function avatarUrl(user: DiscordUser): string {
  if (user.avatar)
    return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${user.avatar.startsWith("a_") ? "gif" : "png"}?size=128`;
  const index =
    user.discriminator && user.discriminator !== "0"
      ? Number(user.discriminator) % 5
      : Number((BigInt(user.id) >> BigInt(22)) % BigInt(6));
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}
