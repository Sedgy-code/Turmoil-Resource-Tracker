import { createPublicKey, verify } from "node:crypto";
import { currentWeek } from "../resources";
import { database, lockAdministration, type Database, type SqlConnection } from "./db";
import { guildId } from "./config";
import { iso, memberFromRow } from "./mappers";
import { awardWeeklyDew, SNIPE_REWARD_WINDOW_MS } from "./planning";
import { decideFromDiscord } from "./applications";

/** The Turmoil Resource Tracker app's public key (not a secret); DISCORD_PUBLIC_KEY overrides it. */
const DEFAULT_PUBLIC_KEY = "d88e07eec52a0316cdf5f908e6e5236bfe5ec519c80bc3beb625f8da44677709";
const DEFAULT_APPLICATION_ID = "1556826056688934983";
/** Check-in opens shortly before a snipe and closes a while after it starts. */
export const CHECKIN_OPENS_BEFORE_MS = 30 * 60 * 1000;
export const CHECKIN_CLOSES_AFTER_MS = 3 * 60 * 60 * 1000;
const EPHEMERAL = 64;

/** Discord signs every request; anything not signed with the app's key is refused. */
export function verifyDiscordSignature(body: string, signature: string | null, timestamp: string | null, publicKeyHex = process.env.DISCORD_PUBLIC_KEY || DEFAULT_PUBLIC_KEY): boolean {
  if (!signature || !timestamp || !/^[0-9a-f]{128}$/i.test(signature)) return false;
  try {
    const key = createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(publicKeyHex, "hex")]), format: "der", type: "spki" });
    return verify(null, Buffer.from(timestamp + body), key, Buffer.from(signature, "hex"));
  } catch {
    return false;
  }
}

type Interaction = {
  type: number;
  guild_id?: string;
  member?: { user?: { id?: string } };
  user?: { id?: string };
  data?: { name?: string; custom_id?: string };
};

const reply = (content: string, ephemeral = true) => ({ type: 4, data: { content, flags: ephemeral ? EPHEMERAL : 0, allowed_mentions: { parse: [] } } });

/** The snipe whose check-in window is open right now (closest start time first). */
async function openSnipe(connection: SqlConnection, now: Date) {
  const rows = await connection.query(`SELECT id, title, starts_at FROM snipe_plans
    WHERE starts_at <= $1 AND starts_at >= $2 ORDER BY ABS(EXTRACT(EPOCH FROM (starts_at - $3::timestamptz))) LIMIT 1`, [
    new Date(now.getTime() + CHECKIN_OPENS_BEFORE_MS).toISOString(),
    new Date(now.getTime() - CHECKIN_CLOSES_AFTER_MS).toISOString(),
    now.toISOString(),
  ]);
  return rows[0] ? { id: String(rows[0].id), title: String(rows[0].title), startsAt: new Date(iso(rows[0].starts_at)!) } : null;
}

/** Marks a member as attending (counts straight away; admins can untick on the site). */
export async function checkIn(discordId: string, snipeId: string | null, db?: Database, now = new Date()): Promise<string> {
  const connection = db ?? await database();
  return connection.transaction(async (tx) => {
    await lockAdministration(tx, connection.dialect);
    const members = await tx.query("SELECT * FROM app_members WHERE discord_id = $1", [discordId]);
    if (!members.length) return "You’re not on Turmoil Clan Hub yet. Sign in once at https://www.resources-turmoil.online then try again.";
    const member = memberFromRow(members[0]);
    if (!member.active) return "Your Clan Hub account is switched off. Ask a clan admin.";
    let plan = await openSnipe(tx, now);
    if (snipeId) {
      const rows = await tx.query("SELECT id, title, starts_at FROM snipe_plans WHERE id = $1", [snipeId]);
      plan = rows[0] ? { id: String(rows[0].id), title: String(rows[0].title), startsAt: new Date(iso(rows[0].starts_at)!) } : null;
    }
    if (!plan) return "There’s no snipe open for check-in right now.";
    const opens = plan.startsAt.getTime() - CHECKIN_OPENS_BEFORE_MS;
    const closes = plan.startsAt.getTime() + CHECKIN_CLOSES_AFTER_MS;
    if (now.getTime() < opens) return `Check-in for **${plan.title}** opens 30 minutes before it starts.`;
    if (now.getTime() > closes) return `Check-in for **${plan.title}** has closed.`;
    const inserted = await tx.query(`INSERT INTO snipe_attendance (snipe_id, member_id, confirmed_by) VALUES ($1, $2, $2)
      ON CONFLICT (snipe_id, member_id) DO NOTHING RETURNING member_id`, [plan.id, member.id]);
    if (!inserted.length) return `You’re already checked in for **${plan.title}**. 🎯`;
    // Same weekly reward as an admin tick; it lands in the snipe's own clan week.
    if (now.getTime() - plan.startsAt.getTime() <= SNIPE_REWARD_WINDOW_MS) await awardWeeklyDew(tx, member.id, "snipe", currentWeek(plan.startsAt));
    // Keep an archived snapshot's attendee list current.
    const archived = await tx.query("SELECT archived_result FROM snipe_plans WHERE id = $1 AND archived = TRUE AND archived_result IS NOT NULL", [plan.id]);
    if (archived.length) {
      const frozen = typeof archived[0].archived_result === "string" ? JSON.parse(archived[0].archived_result) : archived[0].archived_result;
      frozen.attendees = [...(frozen.attendees ?? []), { memberId: member.id, confirmedBy: member.id, confirmedAt: now.toISOString(), member }];
      await tx.query("UPDATE snipe_plans SET archived_result = $2::jsonb WHERE id = $1", [plan.id, JSON.stringify(frozen)]);
    }
    return `✅ Checked in for **${plan.title}**, ${member.username}! Thanks for showing up. (+10 Clan Points, once a week)`;
  });
}

async function isAdmin(connection: SqlConnection, discordId: string): Promise<boolean> {
  const rows = await connection.query("SELECT role, active FROM app_members WHERE discord_id = $1", [discordId]);
  return rows[0]?.active === true && rows[0]?.role === "ADMIN";
}

/** Handles slash commands and button presses sent by Discord. */
export async function handleInteraction(interaction: Interaction, db?: Database, now = new Date()): Promise<unknown> {
  if (interaction.type === 1) return { type: 1 };
  const connection = db ?? await database();
  const discordId = interaction.member?.user?.id ?? interaction.user?.id;
  if (!discordId) return reply("Please use this inside the Turmoil server.");
  if (interaction.guild_id && guildId() && interaction.guild_id !== guildId()) return reply("This only works in the Turmoil server.");
  if (interaction.type === 3 && interaction.data?.custom_id?.startsWith("checkin:")) {
    return reply(await checkIn(discordId, interaction.data.custom_id.slice("checkin:".length), connection, now));
  }
  const application = interaction.type === 3 ? /^app:(accepted|declined):([0-9a-f-]{36})$/.exec(interaction.data?.custom_id ?? "") : null;
  if (application) {
    const result = await decideFromDiscord(discordId, application[2], application[1] as "accepted" | "declined", connection, now);
    // Type 7 replaces the application message, so the buttons disappear once answered.
    return "error" in result ? reply(result.error) : { type: 7, data: result.message };
  }
  if (interaction.type === 2 && interaction.data?.name === "checkin") return reply(await checkIn(discordId, null, connection, now));
  if (interaction.type === 2 && interaction.data?.name === "snipe-start") {
    if (!(await isAdmin(connection, discordId))) return reply("Only clan admins can start snipe check-in.");
    const plan = await openSnipe(connection, now);
    if (!plan) return reply("No snipe starts within 30 minutes. Create it on the Snipe Plans page first, then try again.");
    const unix = Math.floor(plan.startsAt.getTime() / 1000);
    return {
      type: 4,
      data: {
        content: `🎯 **${plan.title}** — check-in is open! Starts <t:${unix}:R>.\nPress the button when you join the snipe. Check-in closes 3 hours after the start.`,
        allowed_mentions: { parse: [] },
        components: [{ type: 1, components: [{ type: 2, style: 3, label: "Check in", emoji: { name: "✅" }, custom_id: `checkin:${plan.id}` }] }],
      },
    };
  }
  return reply("Unknown command.");
}

/** Adds /checkin and /snipe-start to the Turmoil server (safe to repeat). */
export async function registerCommands(fetcher: typeof fetch = fetch): Promise<boolean> {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token || !guildId()) {
    console.warn("Discord commands not registered: bot token or server id missing");
    return false;
  }
  const applicationId = process.env.DISCORD_CLIENT_ID || DEFAULT_APPLICATION_ID;
  const response = await fetcher(`https://discord.com/api/v10/applications/${applicationId}/guilds/${guildId()}/commands`, {
    method: "PUT",
    headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify([
      { name: "checkin", description: "Check in for the snipe that's happening now (+10 Clan Points)", type: 1 },
      { name: "snipe-start", description: "Admins: post the check-in button for the snipe starting now", type: 1 },
    ]),
  });
  if (!response.ok) {
    // Discord's error text never includes the token; it explains what's missing (e.g. "Missing Access").
    console.warn("Discord commands not registered", response.status, (await response.text()).slice(0, 300));
  }
  return response.ok;
}
