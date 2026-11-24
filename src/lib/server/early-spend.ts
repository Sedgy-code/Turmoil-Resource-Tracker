import { randomUUID } from "node:crypto";
import { EARLY_TOP, resourcesOnDay, snipeForZone, SPEND_INFO, SPEND_RESOURCES } from "../spending-order";

export { EARLY_TOP, snipeForZone };
import type { EarlySpendCheck, EarlySpendRequest, Member, ResetZone, SpendResource, SpendRow } from "../types";
import { appUrl, guildId, isDemo } from "./config";
import { database, type Database, type SqlConnection } from "./db";
import { earlySpend } from "./early-spend-store";
import { ApiError } from "./errors";
import { memberFromRow } from "./mappers";
import {
  activeMember, botToken, buildOrders, closeThread, type Context, dayStart, DISCORD_API, discordReason, lineSnipe, loadContext,
  plainName, refreshDayPost, RESOURCE_EMOJI, shortNumber, spendingSettings,
} from "./spending-order";

/*
 * Early spend requests (a member's idea, set up with leadership): on a snipe day, a member who can't
 * make the snipe can ask to spend that line early. Only the top 20 in the line who have enough to
 * ascend can ask, and only once they've picked a time zone role in Discord. If the snipe falls in
 * their night (11 pm to 7 am) no reason is needed; otherwise they must say why. Any leader approves
 * or declines, in the Hub or with the buttons on the request's message in that day's Discord post.
 */

/** #⏲️-pick-your-timezone: members pick a "Reset …" role there. */
export const PICK_TIMEZONE_CHANNEL_ID = "1559772353473417246";
/** #⏰-early-spend-requests: a leaders-only forum in the Leadership section; each request is a ticket (a post) there. */
export const EARLY_CHANNEL_ID = "1574741242481217607";
/** The local demo has no Discord: everyone gets this time zone there. */
const DEMO_ZONE: ResetZone = { name: "Reset 8–9am · UTC+8 to +9", from: 8, to: 9 };

const NO_ZONE = "Pick your time zone in #⏲️-pick-your-timezone on Discord first, then ask again.";

interface Dependencies { db?: Database | SqlConnection; fetcher?: typeof fetch; now?: Date }

/** English text with its {placeholders} filled in (Discord; the Hub translates the template). */
function fill(text: string, values: Record<string, string | number> = {}): string {
  return text.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? String(values[key]) : match));
}

/* ------------------------------------------------------------------------------------------------
 * Time zones: the "Reset …" roles members pick in Discord, e.g. "Reset 8–9am · UTC+8 to +9".
 * ---------------------------------------------------------------------------------------------- */

/** The UTC offsets a role covers: "UTC+8 to +9", "UTC−8 to −6" (any minus sign), "UTC+5:30". */
export function parseResetZone(name: string): ResetZone | null {
  const text = name.replace(/[−–—]/g, "-");
  const offset = "([+-]?\\d{1,2}(?:[:.]\\d{2})?)";
  const match = new RegExp(`UTC\\s*${offset}(?:\\s*to\\s*${offset})?`, "i").exec(text);
  if (!match) return null;
  const hours = (value: string) => {
    const [whole, minutes = "0"] = value.split(/[:.]/);
    const sign = whole.startsWith("-") ? -1 : 1;
    return sign * (Math.abs(Number(whole)) + Number(minutes) / 60);
  };
  const first = hours(match[1]);
  const second = match[2] === undefined ? first : hours(match[2]);
  if (![first, second].every((value) => Number.isFinite(value) && value >= -12 && value <= 14)) return null;
  return { name: name.trim(), from: Math.min(first, second), to: Math.max(first, second) };
}

/** The member's time zone from their Discord roles (the first "Reset … UTC…" role they have). */
export function zoneFromRoles(roleIds: readonly string[], guildRoles: readonly { id: string; name: string }[]): ResetZone | null {
  for (const id of roleIds) {
    const role = guildRoles.find((item) => item.id === id);
    const zone = role ? parseResetZone(role.name) : null;
    if (zone) return zone;
  }
  return null;
}

async function discordJson<T>(path: string, token: string, fetcher: typeof fetch): Promise<T | null> {
  const response = await fetcher(`${DISCORD_API}${path}`, { headers: { Authorization: `Bot ${token}` } }).catch(() => null);
  if (!response?.ok) return null;
  return (await response.json().catch(() => null)) as T | null;
}

/** The server's roles change rarely: kept for a few minutes so Discord's buttons answer quickly. */
let rolesCache: { at: number; guild: string; roles: { id: string; name: string }[] } | null = null;
const ROLES_CACHE_MS = 10 * 60_000;

async function serverRoles(guild: string, token: string, fetcher: typeof fetch): Promise<{ id: string; name: string }[] | null> {
  if (rolesCache && rolesCache.guild === guild && Date.now() - rolesCache.at < ROLES_CACHE_MS) return rolesCache.roles;
  const roles = await discordJson<{ id: string; name: string }[]>(`/guilds/${guild}/roles`, token, fetcher);
  if (!Array.isArray(roles)) return null;
  rolesCache = { at: Date.now(), guild, roles: roles.map((role) => ({ id: String(role.id), name: String(role.name) })) };
  return rolesCache.roles;
}

/** Their time zone, read live from Discord (roles from a button press come with it; the Hub looks them up). */
export async function memberZone(discordId: string, roleIds: readonly string[] | undefined, fetcher: typeof fetch = fetch): Promise<ResetZone | null> {
  if (isDemo()) return DEMO_ZONE;
  const token = botToken();
  if (!token || !guildId()) return null;
  const guild = encodeURIComponent(guildId());
  const ids = roleIds ?? (await discordJson<{ roles?: string[] }>(`/guilds/${guild}/members/${encodeURIComponent(discordId)}`, token, fetcher))?.roles ?? [];
  if (!ids.length) return null;
  const roles = await serverRoles(guild, token, fetcher);
  return roles ? zoneFromRoles(ids, roles) : null;
}

/* ------------------------------------------------------------------------------------------------
 * Who can ask.
 * ---------------------------------------------------------------------------------------------- */

type LineCheck =
  | { ok: true; row: SpendRow; snipe: Context["snipes"][number] }
  | { ok: false; why: string; values?: Record<string, string | number>; snipe?: Context["snipes"][number] };

/** Whether a member can ask to spend a line early on a clan day: a snipe planned and not started, top 20, ready to ascend. */
export function lineCheck(context: Context, memberId: string, day: number, resource: SpendResource): LineCheck {
  if (!SPEND_RESOURCES.includes(resource) || !resourcesOnDay(day).includes(resource) || !context.clanDays.includes(day)) {
    return { ok: false, why: "That isn’t a clan day for this line." };
  }
  if (context.now.getTime() >= dayStart(context.week, day + 1).getTime()) return { ok: false, why: "That clan day is over." };
  const snipe = lineSnipe(context, day, resource);
  if (!snipe) return { ok: false, why: "No snipe is planned for this line that day, so there’s nothing to spend early for." };
  if (snipe.startsAt.getTime() <= context.now.getTime()) return { ok: false, why: "That snipe has already started.", snipe };
  const line = buildOrders(context, day).find((item) => item.resource === resource);
  const row = line?.rows.find((item) => item.member.id === memberId);
  if (!row || row.state !== "line" || row.place === null) return { ok: false, why: "You’re not in this line.", snipe };
  if (row.place > EARLY_TOP) return { ok: false, why: "Only the top {top} in the line can ask. You’re #{place}.", values: { top: EARLY_TOP, place: row.place }, snipe };
  if (row.check.state !== "ready") return { ok: false, why: "You need enough saved to ascend before you can ask.", snipe };
  return { ok: true, row, snipe };
}

function openRequest(context: Context, memberId: string, day: number, resource: SpendResource): EarlySpendRequest | undefined {
  return context.early.find((item) => item.member.id === memberId && item.day === day && item.resource === resource && (item.status === "pending" || item.status === "approved"));
}

/** The Hub, before its form opens: can this member ask, what time the snipe is for them, and is a reason needed. */
export async function earlySpendCheck(actor: Member, input: { day: number; resource: SpendResource }, dependencies: Dependencies = {}): Promise<EarlySpendCheck> {
  const connection = dependencies.db ?? await database();
  const now = dependencies.now ?? new Date();
  const member = await activeMember(connection, actor.id);
  const context = await loadContext(connection, now);
  const check = lineCheck(context, member.id, input.day, input.resource);
  const snipeAt = check.snipe?.startsAt.toISOString() ?? null;
  const none = { zone: null, snipeAt, localTime: null, night: false, reasonRequired: true };
  if (!check.ok) return { canAsk: false, blocked: check.why, ...(check.values ? { values: check.values } : {}), ...none };
  if (openRequest(context, member.id, input.day, input.resource)) return { canAsk: false, blocked: "You’ve already asked to spend early for this line.", ...none };
  const zone = await memberZone(member.discordId, undefined, dependencies.fetcher ?? fetch);
  if (!zone) return { canAsk: false, needsZone: true, blocked: NO_ZONE, ...(guildId() ? { zoneUrl: `https://discord.com/channels/${guildId()}/${PICK_TIMEZONE_CHANNEL_ID}` } : {}), ...none };
  const local = snipeForZone(check.snipe.startsAt, zone);
  return { canAsk: true, zone, snipeAt, localTime: local.localTime, night: local.night, reasonRequired: !local.night };
}

/** "06:30" on the clan day, before the snipe and not already past; empty means any time before the snipe. */
function spendTime(text: string | null | undefined, context: Context, day: number, snipeAt: Date): Date | null {
  const value = (text ?? "").trim();
  if (!value) return null;
  const match = /^(\d{1,2})(?:[:.h]?(\d{2}))?$/i.exec(value);
  const hours = match ? Number(match[1]) : NaN;
  const minutes = match?.[2] ? Number(match[2]) : 0;
  if (!match || hours > 23 || minutes > 59) throw new ApiError(400, "Write the time like 06:30 (UTC).", "EARLY_BAD_TIME");
  const at = new Date(dayStart(context.week, day).getTime() + (hours * 60 + minutes) * 60_000);
  if (at.getTime() >= snipeAt.getTime()) throw new ApiError(400, "Pick a time before the snipe.", "EARLY_BAD_TIME");
  if (at.getTime() < context.now.getTime() - 15 * 60_000) throw new ApiError(400, "That time has already passed. Pick a later one, or leave it empty.", "EARLY_BAD_TIME");
  return at;
}

/** A member asks (the Hub, or the form from the Discord post's button). */
export async function askEarlySpend(
  actor: Member,
  input: { day: number; resource: SpendResource; spendAt?: string | null; reason?: string | null },
  dependencies: Dependencies & { roles?: readonly string[] } = {},
): Promise<EarlySpendRequest> {
  const connection = dependencies.db ?? await database();
  const now = dependencies.now ?? new Date();
  const member = await activeMember(connection, actor.id);
  const context = await loadContext(connection, now);
  const check = lineCheck(context, member.id, input.day, input.resource);
  if (!check.ok) throw new ApiError(409, fill(check.why, check.values), "EARLY_NOT_ALLOWED");
  if (openRequest(context, member.id, input.day, input.resource)) throw new ApiError(409, "You’ve already asked to spend early for this line.", "EARLY_ALREADY_ASKED");
  const zone = await memberZone(member.discordId, dependencies.roles, dependencies.fetcher ?? fetch);
  if (!zone) throw new ApiError(409, NO_ZONE, "EARLY_NO_TIMEZONE");
  const local = snipeForZone(check.snipe.startsAt, zone);
  const reason = (input.reason ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
  if (!local.night && reason.length < 3) {
    throw new ApiError(400, "The snipe is at a reasonable time for you, so please say why you can’t make it.", "EARLY_REASON_NEEDED");
  }
  const at = spendTime(input.spendAt, context, input.day, check.snipe.startsAt);
  // Asking again after a decline or a cancel reuses the row (one per member, day and line), with a fresh message in Discord.
  const rows = await connection.query(`INSERT INTO early_spends (id, war_week, war_day, resource, member_id, status, spend_at, reason, place, points, zone, snipe_at, night, requested_at)
    VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7, $8, $9, $10::jsonb, $11, $12, $13)
    ON CONFLICT (war_week, war_day, resource, member_id) DO UPDATE SET status = 'pending', spend_at = EXCLUDED.spend_at, reason = EXCLUDED.reason,
      place = EXCLUDED.place, points = EXCLUDED.points, zone = EXCLUDED.zone, snipe_at = EXCLUDED.snipe_at, night = EXCLUDED.night,
      requested_at = EXCLUDED.requested_at, decided_by = NULL, decided_at = NULL, notice_channel_id = '', notice_message_id = ''
    WHERE early_spends.status IN ('declined', 'cancelled')
    RETURNING id`, [
    randomUUID(), context.week, input.day, input.resource, member.id, at?.toISOString() ?? null, reason, check.row.place, Math.round(check.row.points),
    JSON.stringify(zone), check.snipe.startsAt.toISOString(), local.night, now.toISOString(),
  ]);
  if (!rows.length) throw new ApiError(409, "You’ve already asked to spend early for this line.", "EARLY_ALREADY_ASKED");
  return (await earlySpend(connection, String(rows[0].id)))!;
}

/** Any leader approves or declines (and can change their mind); the member who asked can cancel. */
export async function decideEarlySpend(
  actor: Member,
  input: { id: string; status: "approved" | "declined" | "cancelled" },
  dependencies: Dependencies = {},
): Promise<EarlySpendRequest> {
  const connection = dependencies.db ?? await database();
  const now = dependencies.now ?? new Date();
  const member = await activeMember(connection, actor.id);
  const request = await earlySpend(connection, input.id);
  if (!request) throw new ApiError(404, "That request can’t be found any more.", "EARLY_NOT_FOUND");
  if (input.status === "cancelled") {
    if (request.member.id !== member.id) throw new ApiError(403, "Only the member who asked can cancel it.", "EARLY_NOT_YOURS");
    if (request.status !== "pending" && request.status !== "approved") throw new ApiError(409, "There’s nothing to cancel.", "EARLY_CLOSED");
    await connection.query("UPDATE early_spends SET status = 'cancelled' WHERE id = $1", [request.id]);
  } else {
    if (member.role !== "ADMIN") throw new ApiError(403, "Only leaders can approve or decline early spends.", "ADMIN_REQUIRED");
    if (request.status === "cancelled") throw new ApiError(409, "They cancelled this request.", "EARLY_CLOSED");
    await connection.query("UPDATE early_spends SET status = $2, decided_by = $3, decided_at = $4 WHERE id = $1", [request.id, input.status, member.id, now.toISOString()]);
  }
  return (await earlySpend(connection, request.id))!;
}

/* ------------------------------------------------------------------------------------------------
 * Discord: each request is a ticket, a post in #⏰-early-spend-requests (leaders only), with Approve
 * and Decline buttons and a Waiting / Approved / Declined / Cancelled tag. Names only, nobody is
 * pinged, English only. Tickets close when their clan day ends.
 * ---------------------------------------------------------------------------------------------- */

function utcClock(at: string): string {
  return new Date(at).toISOString().slice(11, 16);
}

function earlyChannelId(): string {
  return process.env.DISCORD_EARLY_CHANNEL_ID || EARLY_CHANNEL_ID;
}

const STATUS_MARK: Record<EarlySpendRequest["status"], string> = { pending: "⏳", approved: "✅", declined: "✖️", cancelled: "↩️" };
const STATUS_TAG: Record<EarlySpendRequest["status"], string> = { pending: "waiting", approved: "approved", declined: "declined", cancelled: "cancelled" };

/** The ticket's title: its state, the day and line, and who asked (forum post titles are at most 100 characters). */
export function earlyTicketTitle(request: EarlySpendRequest): string {
  return `${STATUS_MARK[request.status]} Day ${request.day} · ${SPEND_INFO[request.resource].label} · ${request.member.username}`.slice(0, 100);
}

/** The request's message: who, their place, the snipe's time for them, when they'll spend, why, and where it stands. */
export function earlyNotice(request: EarlySpendRequest) {
  const info = SPEND_INFO[request.resource];
  const local = request.zone ? snipeForZone(new Date(request.snipeAt), request.zone) : null;
  const status = {
    pending: "Waiting for a leader to approve or decline.",
    approved: `✅ **Approved** by ${plainName(request.decidedBy ?? "a leader")}`,
    declined: `✖️ **Declined** by ${plainName(request.decidedBy ?? "a leader")}`,
    cancelled: `↩️ Cancelled by ${plainName(request.member.username)}`,
  }[request.status];
  const content = [
    `⏰ **Early spend request** · Day ${request.day} · ${RESOURCE_EMOJI[request.resource]} ${info.label}`,
    `**${plainName(request.member.username)}** · ${request.place !== null ? `#${request.place} in line · ` : ""}✅ ready to ascend · ${shortNumber(request.points)} pts`,
    `🎯 Snipe at ${utcClock(request.snipeAt)} UTC${local && request.zone ? ` · ${local.localTime} for them${local.night ? " 🌙" : ""} (${plainName(request.zone.name)})` : ""}`,
    `🕒 Spends ${request.spendAt ? `at ${utcClock(request.spendAt)} UTC` : "any time before the snipe"}`,
    request.reason ? `💬 “${plainName(request.reason)}”` : "💬 No reason needed: the snipe is in their night.",
    status,
  ].join("\n");
  const approve = { type: 2, style: 3, label: "Approve", emoji: { name: "✅" }, custom_id: `early:approve:${request.id}` };
  const decline = { type: 2, style: 4, label: "Decline", emoji: { name: "✖️" }, custom_id: `early:decline:${request.id}` };
  // Leaders can change their mind: an approved request keeps Decline, a declined one keeps Approve.
  const buttons = request.status === "pending" ? [approve, decline] : request.status === "approved" ? [decline] : request.status === "declined" ? [approve] : [];
  return { content, components: buttons.length ? [{ type: 1, components: buttons }] : [], allowed_mentions: { parse: [] as string[] } };
}

/** The forum's tags by name (Waiting, Approved, Declined, Cancelled), kept for a few minutes. */
let tagsCache: { at: number; channel: string; tags: Map<string, string> } | null = null;
async function ticketTags(token: string, fetcher: typeof fetch): Promise<Map<string, string>> {
  const channel = earlyChannelId();
  if (tagsCache && tagsCache.channel === channel && Date.now() - tagsCache.at < ROLES_CACHE_MS) return tagsCache.tags;
  const forum = await discordJson<{ available_tags?: { id: string; name: string }[] }>(`/channels/${channel}`, token, fetcher);
  const tags = new Map((forum?.available_tags ?? []).map((tag) => [String(tag.name).trim().toLowerCase(), String(tag.id)]));
  tagsCache = { at: Date.now(), channel, tags };
  return tags;
}
async function ticketTag(request: EarlySpendRequest, token: string, fetcher: typeof fetch): Promise<string[]> {
  const tag = (await ticketTags(token, fetcher)).get(STATUS_TAG[request.status]);
  return tag ? [tag] : [];
}

/** Opens a new request's ticket (when early requests are switched on for Discord). */
export async function postEarlyNotice(id: string, dependencies: Dependencies = {}): Promise<boolean> {
  const token = botToken();
  if (!token) return false;
  const connection = dependencies.db ?? await database();
  if (!(await spendingSettings(connection)).earlyDiscord) return false;
  const request = await earlySpend(connection, id);
  if (!request || request.status !== "pending" || request.noticeMessageId) return false;
  const fetcher = dependencies.fetcher ?? fetch;
  const response = await fetcher(`${DISCORD_API}/channels/${earlyChannelId()}/threads`, {
    method: "POST",
    headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: earlyTicketTitle(request), auto_archive_duration: 4320, applied_tags: await ticketTag(request, token, fetcher), message: earlyNotice(request) }),
  });
  if (!response.ok) {
    console.warn("Early spend ticket not opened:", await discordReason(response));
    return false;
  }
  const thread = (await response.json().catch(() => ({}))) as { id?: unknown };
  // A forum post's first message has the post's id.
  if (thread.id) await connection.query("UPDATE early_spends SET notice_channel_id = $2, notice_message_id = $2 WHERE id = $1", [id, String(thread.id)]);
  return true;
}

/**
 * After a decision or a cancel: the ticket shows it (its message, title and tag), and that day's
 * spending order post marks approved members ⏰. With `skipNotice`, Discord already rewrote the
 * message (a leader pressed its button).
 */
export async function afterEarlyChange(id: string, dependencies: Dependencies & { skipNotice?: boolean } = {}): Promise<void> {
  const token = botToken();
  if (!token) return;
  const connection = dependencies.db ?? await database();
  const fetcher = dependencies.fetcher ?? fetch;
  const request = await earlySpend(connection, id);
  if (!request) return;
  const headers = { Authorization: `Bot ${token}`, "Content-Type": "application/json" };
  if (request.noticeChannelId && request.noticeMessageId) {
    if (!dependencies.skipNotice) {
      const edited = await fetcher(`${DISCORD_API}/channels/${request.noticeChannelId}/messages/${request.noticeMessageId}`, {
        method: "PATCH", headers, body: JSON.stringify(earlyNotice(request)),
      }).catch(() => null);
      if (edited && !edited.ok) console.warn("Early spend ticket not updated:", await discordReason(edited));
    }
    const renamed = await fetcher(`${DISCORD_API}/channels/${request.noticeChannelId}`, {
      method: "PATCH", headers, body: JSON.stringify({ name: earlyTicketTitle(request), applied_tags: await ticketTag(request, token, fetcher) }),
    }).catch(() => null);
    if (renamed && !renamed.ok) console.warn("Early spend ticket tag not updated:", await discordReason(renamed));
  }
  await refreshDayPost(connection, request.week, request.day, { fetcher, now: dependencies.now }).catch((error) => console.warn("Spending post not refreshed:", error));
}

/** The daily job: tickets whose clan day has ended are closed (archived and locked), so the forum shows what's current. */
export async function closeEarlyTickets(dependencies: Dependencies = {}): Promise<number> {
  const token = botToken();
  if (!token) return 0;
  const connection = dependencies.db ?? await database();
  const fetcher = dependencies.fetcher ?? fetch;
  const now = dependencies.now ?? new Date();
  const rows = await connection.query(`SELECT id, war_week::text AS week, war_day, notice_channel_id FROM early_spends
    WHERE notice_channel_id <> '' AND notice_closed_at IS NULL`);
  let closed = 0;
  for (const row of rows) {
    if (dayStart(String(row.week).slice(0, 10), Number(row.war_day) + 1).getTime() > now.getTime()) continue;
    if (await closeThread(String(row.notice_channel_id), token, fetcher)) {
      await connection.query("UPDATE early_spends SET notice_closed_at = $2 WHERE id = $1", [row.id, now.toISOString()]);
      closed++;
    }
  }
  return closed;
}

/* ------------------------------------------------------------------------------------------------
 * The Discord side: the post's "Ask to spend early" button, the line picker, the form, and the
 * leaders' Approve / Decline buttons.
 * ---------------------------------------------------------------------------------------------- */

const EPHEMERAL = 64;
const ephemeral = (content: string, components: unknown[] = []) => ({ type: 4, data: { content, flags: EPHEMERAL, components, allowed_mentions: { parse: [] } } });

export type EarlyInteraction = {
  type: number;
  member?: { user?: { id?: string }; roles?: string[] };
  user?: { id?: string };
  data?: { custom_id?: string; components?: { components?: { custom_id?: string; value?: string }[] }[] };
};

export function isEarlyInteraction(customId: string | undefined): boolean {
  return /^early:(ask|pick|form|approve|decline):/.test(customId ?? "");
}

function earlyForm(week: string, day: number, resource: SpendResource, local: { localTime: string; night: boolean }) {
  const label = SPEND_INFO[resource].label;
  return {
    type: 9,
    data: {
      custom_id: `early:form:${week}:${day}:${resource}`,
      title: `Spend ${label} early – Day ${day}`.slice(0, 45),
      components: [
        { type: 1, components: [{ type: 4, custom_id: "spend_time", label: "When will you spend? (UTC, like 06:30)", style: 1, required: false, max_length: 5, placeholder: "Leave empty: any time before the snipe" }] },
        { type: 1, components: [{
          type: 4, custom_id: "reason", style: 2, max_length: 300, required: !local.night, ...(local.night ? {} : { min_length: 3 }),
          label: local.night ? "Anything to add? (optional)" : "Why can’t you make the snipe?",
          placeholder: `The snipe is at ${local.localTime} for you${local.night ? ", in your night" : ""}.`.slice(0, 100),
        }] },
      ],
    },
  };
}

function formValue(interaction: EarlyInteraction, id: string): string {
  for (const row of interaction.data?.components ?? []) for (const input of row.components ?? []) if (input.custom_id === id) return String(input.value ?? "");
  return "";
}

/** Discord buttons and the form for early spend requests (see discord-interactions.ts). */
export async function handleEarlyInteraction(
  connection: SqlConnection,
  interaction: EarlyInteraction,
  discordId: string,
  now: Date,
  fetcher: typeof fetch,
  later: (task: () => Promise<unknown>) => void,
): Promise<unknown> {
  const [, action, first, second, third] = (interaction.data?.custom_id ?? "").split(":");
  const rows = await connection.query("SELECT * FROM app_members WHERE discord_id = $1 AND active = TRUE", [discordId]);
  if (!rows.length) return ephemeral(`You’re not on the Turmoil Clan Hub yet. Sign in once at ${appUrl()} then try again.`);
  const member = memberFromRow(rows[0]);

  // Leaders: Approve / Decline on a request's message. Type 7 rewrites that message in place.
  if (action === "approve" || action === "decline") {
    if (member.role !== "ADMIN") return ephemeral("Only leaders can approve or decline early spends.");
    try {
      const request = await decideEarlySpend(member, { id: first, status: action === "approve" ? "approved" : "declined" }, { db: connection, now });
      later(() => afterEarlyChange(request.id, { db: connection, fetcher, now, skipNotice: true }));
      return { type: 7, data: earlyNotice(request) };
    } catch (error) {
      return ephemeral(error instanceof ApiError ? error.message : "Something went wrong. Please try again.");
    }
  }

  const week = first;
  const day = Number(second);
  const context = await loadContext(connection, now);
  if (context.week !== week) return ephemeral("This post is for an earlier war, so there’s nothing to ask for.");

  if (action === "form") {
    try {
      const request = await askEarlySpend(member, {
        day, resource: third as SpendResource, spendAt: formValue(interaction, "spend_time"), reason: formValue(interaction, "reason"),
      }, { db: connection, fetcher, now, roles: interaction.member?.roles ?? [] });
      later(() => postEarlyNotice(request.id, { db: connection, fetcher }));
      return ephemeral(`✅ Sent! Leadership will approve or decline it soon. Check where it stands on the Clan Hub (${appUrl()}/spending-order) or press the button again.`);
    } catch (error) {
      return ephemeral(error instanceof ApiError ? `${error.message} Press the button to try again.` : "Something went wrong. Please try again.");
    }
  }

  // The post's button (or a line picked from the list it shows): which lines can they ask for?
  const zone = await memberZone(discordId, interaction.member?.roles ?? [], fetcher);
  if (!zone) return ephemeral(`Pick your time zone in <#${PICK_TIMEZONE_CHANNEL_ID}> first, then press the button again.`);
  const lines = (action === "pick" ? [third as SpendResource] : resourcesOnDay(day)).filter((resource) => SPEND_RESOURCES.includes(resource));
  const checked = lines.map((resource) => ({ resource, check: lineCheck(context, member.id, day, resource), asked: openRequest(context, member.id, day, resource) }));
  const open = checked.filter((item) => item.check.ok && !item.asked);
  if (!open.length) {
    const why = checked.map((item) => `${RESOURCE_EMOJI[item.resource]} **${SPEND_INFO[item.resource].label}:** ${item.asked
      ? item.asked.status === "approved" ? "you’re approved to spend early." : "you’ve already asked; leadership will reply soon."
      : item.check.ok ? "" : fill(item.check.why, item.check.values)}`);
    return ephemeral([`You can’t ask to spend early on Day ${day}:`, ...why, "", `Only the top ${EARLY_TOP} in a line who have enough to ascend can ask, when a snipe is planned.`].join("\n"));
  }
  if (open.length === 1) {
    const only = open[0];
    if (!only.check.ok) return ephemeral("Something went wrong. Please try again.");
    return earlyForm(week, day, only.resource, snipeForZone(only.check.snipe.startsAt, zone));
  }
  return ephemeral(`Which line do you want to spend early on Day ${day}?`, [{
    type: 1,
    components: open.map((item) => ({ type: 2, style: 2, label: SPEND_INFO[item.resource].label, emoji: { name: RESOURCE_EMOJI[item.resource] }, custom_id: `early:pick:${week}:${day}:${item.resource}` })),
  }]);
}
