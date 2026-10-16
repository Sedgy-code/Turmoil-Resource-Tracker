import { createHash, randomUUID } from "node:crypto";
import type { Application, ApplicationSettings, ApplicationStatus, Member } from "../types";
import { appUrl } from "./config";
import { database, type Database, type SqlConnection } from "./db";
import { ApiError } from "./errors";
import { iso, memberFromRow } from "./mappers";

/** Private #📝-applications channel (leadership and bots only). */
export const APPLICATIONS_CHANNEL_ID = "1560565574528933969";
const MAX_PER_HOUR = 3;
const COLORS: Record<ApplicationStatus, number> = { pending: 0xd9a52b, accepted: 0x69d58b, declined: 0xd9534f };

export interface ApplicationInput {
  gameName: string;
  discordName: string;
  power: string;
  stage: string;
  server: string;
  timezone: string;
  warDays: string;
  languages: string;
  about: string;
}

function fromRow(row: Record<string, unknown>): Application {
  return {
    id: String(row.id),
    status: row.status as ApplicationStatus,
    gameName: String(row.game_name),
    discordName: String(row.discord_name),
    power: String(row.power ?? ""),
    stage: String(row.stage ?? ""),
    server: String(row.server ?? ""),
    timezone: String(row.timezone ?? ""),
    warDays: String(row.war_days ?? ""),
    languages: String(row.languages ?? ""),
    about: String(row.about ?? ""),
    createdAt: iso(row.created_at)!,
    decidedAt: iso(row.decided_at),
    decidedBy: row.decided_by ? String(row.decided_by) : null,
  };
}

export async function applicationSettings(connection: SqlConnection): Promise<ApplicationSettings> {
  const rows = await connection.query("SELECT applications_open, applications_channel_id FROM clan_settings WHERE id = 'clan'");
  return {
    open: rows.length ? rows[0].applications_open !== false : true,
    channelId: rows[0]?.applications_channel_id ? String(rows[0].applications_channel_id) : APPLICATIONS_CHANNEL_ID,
  };
}

async function requireAdmin(connection: SqlConnection, actor: Member) {
  const rows = await connection.query("SELECT * FROM app_members WHERE id = $1 AND active = TRUE", [actor.id]);
  if (!rows.length || rows[0].role !== "ADMIN") throw new ApiError(403, "Only administrators can do this.", "ADMIN_REQUIRED");
  return memberFromRow(rows[0]);
}

export async function saveApplicationSettings(actor: Member, input: Partial<ApplicationSettings>, db?: Database): Promise<ApplicationSettings> {
  const connection = db ?? await database();
  await requireAdmin(connection, actor);
  const current = await applicationSettings(connection);
  const next = { open: input.open ?? current.open, channelId: input.channelId ?? current.channelId };
  if (!/^\d{17,20}$/.test(next.channelId)) throw new ApiError(400, "The channel ID should be a long number. In Discord, right-click the channel → Copy Channel ID.", "INVALID_CHANNEL");
  await connection.query(`INSERT INTO clan_settings (id, applications_open, applications_channel_id) VALUES ('clan', $1, $2)
    ON CONFLICT (id) DO UPDATE SET applications_open = EXCLUDED.applications_open, applications_channel_id = EXCLUDED.applications_channel_id`, [next.open, next.channelId]);
  return next;
}

/** The Discord message for an application, with Accept / Decline buttons while it's still open. */
export function applicationMessage(application: Application) {
  const field = (name: string, value: string, inline = true) => ({ name, value: value.trim() || "—", inline });
  const decided = application.status !== "pending";
  return {
    allowed_mentions: { parse: [] },
    embeds: [{
      title: `📝 ${application.gameName} wants to join Turmoil`,
      color: COLORS[application.status],
      fields: [
        field("Discord", application.discordName),
        field("Power", application.power),
        field("Stage", application.stage),
        field("Server", application.server),
        field("Time zone", application.timezone),
        field("War days per week", application.warDays),
        field("Languages", application.languages),
        field("About them", application.about.slice(0, 1000), false),
      ],
      footer: { text: decided ? `${application.status === "accepted" ? "✅ Accepted" : "❌ Declined"}${application.decidedBy ? ` by ${application.decidedBy}` : ""}` : "Leadership: accept or decline below, or on the Clan Hub" },
      timestamp: application.createdAt,
    }],
    components: decided ? [] : [{
      type: 1,
      components: [
        { type: 2, style: 3, label: "Accept", custom_id: `app:accepted:${application.id}` },
        { type: 2, style: 4, label: "Decline", custom_id: `app:declined:${application.id}` },
        { type: 2, style: 5, label: "Open Clan Hub", url: `${appUrl()}/applications` },
      ],
    }],
  };
}

async function discord(path: string, method: "POST" | "PATCH", body: unknown, fetcher: typeof fetch) {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) return null;
  const response = await fetcher(`https://discord.com/api/v10${path}`, {
    method,
    headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    console.warn("Discord application message failed", response.status, (await response.text()).slice(0, 300));
    return null;
  }
  return await response.json() as { id?: string };
}

/** A new application from the public Apply page. Posted to the private leadership channel. */
export async function submitApplication(input: ApplicationInput, ip: string, dependencies: { db?: Database; fetcher?: typeof fetch; now?: Date } = {}): Promise<Application> {
  const connection = dependencies.db ?? await database();
  const now = dependencies.now ?? new Date();
  const settings = await applicationSettings(connection);
  if (!settings.open) throw new ApiError(403, "Turmoil isn’t taking applications right now. Check back soon.", "APPLICATIONS_CLOSED");
  const ipHash = createHash("sha256").update(`turmoil-apply:${ip}`).digest("hex").slice(0, 32);
  const recent = await connection.query("SELECT COUNT(*)::int AS count FROM applications WHERE ip_hash = $1 AND created_at > $2", [ipHash, new Date(now.getTime() - 3_600_000).toISOString()]);
  if (Number(recent[0]?.count ?? 0) >= MAX_PER_HOUR) throw new ApiError(429, "You’ve sent a few applications already. Please wait an hour and try again.", "TOO_MANY_APPLICATIONS");
  const rows = await connection.query(`INSERT INTO applications (id, game_name, discord_name, power, stage, server, timezone, war_days, languages, about, ip_hash, created_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
  [randomUUID(), input.gameName, input.discordName, input.power, input.stage, input.server, input.timezone, input.warDays, input.languages, input.about, ipHash, now.toISOString()]);
  const application = fromRow(rows[0]);
  const posted = await discord(`/channels/${settings.channelId}/messages`, "POST", applicationMessage(application), dependencies.fetcher ?? fetch);
  if (posted?.id) await connection.query("UPDATE applications SET discord_message_id = $2 WHERE id = $1", [application.id, posted.id]);
  return application;
}

export async function listApplications(actor: Member, db?: Database): Promise<{ applications: Application[]; settings: ApplicationSettings }> {
  const connection = db ?? await database();
  await requireAdmin(connection, actor);
  const rows = await connection.query("SELECT * FROM applications ORDER BY created_at DESC LIMIT 200");
  return { applications: rows.map(fromRow), settings: await applicationSettings(connection) };
}

/**
 * Accepts or declines an application, from the Clan Hub or a Discord button. `decider` is the
 * admin's name. Returns the updated application, or null if it was already decided.
 */
async function decide(connection: SqlConnection, id: string, status: Exclude<ApplicationStatus, "pending">, decider: string, now: Date): Promise<{ application: Application; messageId: string | null } | null> {
  const rows = await connection.query(`UPDATE applications SET status = $2, decided_by = $3, decided_at = $4 WHERE id = $1 AND status = 'pending' RETURNING *`,
    [id, status, decider, now.toISOString()]);
  if (!rows.length) return null;
  return { application: fromRow(rows[0]), messageId: rows[0].discord_message_id ? String(rows[0].discord_message_id) : null };
}

export async function decideApplication(actor: Member, id: string, status: Exclude<ApplicationStatus, "pending">, dependencies: { db?: Database; fetcher?: typeof fetch; now?: Date } = {}): Promise<Application> {
  const connection = dependencies.db ?? await database();
  const admin = await requireAdmin(connection, actor);
  const result = await decide(connection, id, status, admin.username, dependencies.now ?? new Date());
  if (!result) throw new ApiError(409, "Someone already answered this application.", "ALREADY_DECIDED");
  // Keep the Discord message in step so nobody answers it twice.
  if (result.messageId) {
    const settings = await applicationSettings(connection);
    await discord(`/channels/${settings.channelId}/messages/${result.messageId}`, "PATCH", applicationMessage(result.application), dependencies.fetcher ?? fetch);
  }
  return result.application;
}

/** A leader pressed Accept or Decline on the Discord message. Returns the new message, or an error text. */
export async function decideFromDiscord(discordId: string, id: string, status: Exclude<ApplicationStatus, "pending">, db?: Database, now = new Date()): Promise<{ message: ReturnType<typeof applicationMessage> } | { error: string }> {
  const connection = db ?? await database();
  const rows = await connection.query("SELECT * FROM app_members WHERE discord_id = $1 AND active = TRUE", [discordId]);
  if (!rows.length || rows[0].role !== "ADMIN") return { error: "Only clan admins on the Clan Hub can answer applications." };
  const result = await decide(connection, id, status, memberFromRow(rows[0]).username, now);
  if (!result) return { error: "Someone already answered this application." };
  return { message: applicationMessage(result.application) };
}
