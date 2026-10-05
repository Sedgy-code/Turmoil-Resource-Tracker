import { ApiError } from "./errors";

export function isDemo(): boolean {
  if (process.env.DEMO_MODE !== "true") return false;
  if (process.env.NODE_ENV === "production") {
    throw new ApiError(
      503,
      "Demo mode is disabled in production.",
      "INVALID_CONFIGURATION",
    );
  }
  return true;
}

export function appUrl(): string {
  const value =
    process.env.APP_URL ||
    (process.env.NODE_ENV !== "production" ? "http://localhost:3000" : "");
  try {
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      throw new Error();
    if (process.env.NODE_ENV === "production" && url.protocol !== "https:")
      throw new Error();
    return url.origin;
  } catch {
    throw new ApiError(
      503,
      "Configure APP_URL with the public application origin.",
      "INVALID_CONFIGURATION",
    );
  }
}

export function configurationIssues(): string[] {
  const issues: string[] = [];
  if (isDemo()) return issues;
  for (const name of [
    "DISCORD_CLIENT_ID",
    "DISCORD_CLIENT_SECRET",
    "AUTH_SECRET",
  ]) {
    if (!process.env[name]) issues.push(name);
  }
  if (!process.env.DISCORD_GUILD_ID && !process.env.DISCORD_SERVER_ID)
    issues.push("DISCORD_GUILD_ID");
  if (process.env.AUTH_SECRET && process.env.AUTH_SECRET.length < 32)
    issues.push("AUTH_SECRET (at least 32 characters)");
  if (process.env.NODE_ENV === "production" && !process.env.DATABASE_URL)
    issues.push("DATABASE_URL");
  try {
    appUrl();
  } catch {
    issues.push("APP_URL");
  }
  return issues;
}

export function requireConfiguration(): void {
  if (configurationIssues().length)
    throw new ApiError(
      503,
      "Discord sign-in is not configured yet. Contact your administrator.",
      "AUTH_NOT_CONFIGURED",
    );
}

export function guildId(): string {
  return process.env.DISCORD_GUILD_ID || process.env.DISCORD_SERVER_ID || "";
}

export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  // A missing Origin must not silently bypass the mutation protection.
  if (!origin || origin !== appUrl())
    throw new ApiError(
      403,
      "This request must come from the tracker.",
      "INVALID_ORIGIN",
    );
}
