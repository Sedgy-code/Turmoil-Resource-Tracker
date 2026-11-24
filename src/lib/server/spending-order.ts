import { currentWeek } from "../resources";
import { earlySpendsFor } from "./early-spend-store";
import { buildOrder, orderDay, orderWeek, resourcesOnDay, SPEND_INFO, SPEND_RESOURCES } from "../spending-order";
import type { AscendCheck, AscensionPillar, EarlySpendRequest, Member, ResourceEntry, SpendOrder, SpendResource, SpendingOrderResponse, SpendingPostEmbed, SpendingPostPreview, WarActivity, WarRates, WarTech } from "../types";
import { parsePillars } from "./ascensions";
import { appUrl, isDemo } from "./config";
import { database, type Database, type SqlConnection } from "./db";
import { ApiError } from "./errors";
import { entryFromRow, iso, memberFromRow } from "./mappers";
import { getSettings } from "./settings";
import { clanDays } from "./war-days";
import { warBoost } from "../war";

const DAY = 86_400_000;
export const DISCORD_API = "https://discord.com/api/v10";
/** #📋-spending-order, a forum channel in the Turmoil server (DISCORD_SPENDING_CHANNEL_ID overrides it). */
export const SPENDING_CHANNEL_ID = "1574254432357584898";

interface SpendingSettings { postEnabled: boolean; earlyDiscord: boolean }

export interface Context {
  now: Date;
  week: string;
  warDay: number;
  nextWar: boolean;
  clanDays: number[];
  members: Member[];
  entries: ResourceEntry[];
  rates: WarRates;
  /** The Clan Tech page's war point bonuses, on top of the rates. */
  warTech: WarTech | undefined;
  ascending: Map<string, AscensionPillar[]>;
  /** Snipes in that war (not cancelled): the war day each is on, when it starts, what it scores with, and who's in it. */
  snipes: { id: string; day: number; startsAt: Date; activities: WarActivity[]; members: Set<string> }[];
  /** Early spend requests for that war (not cancelled). */
  early: EarlySpendRequest[];
  settings: SpendingSettings;
}

function jsonValue<T>(value: unknown): T {
  return (typeof value === "string" ? JSON.parse(value) : value) as T;
}

/** 00:00 UTC on a war day: Day 1 is the Tuesday after the war's Monday. */
export function dayStart(week: string, day: number): Date {
  return new Date(Date.parse(`${week}T00:00:00Z`) + day * DAY);
}

export async function activeMember(connection: SqlConnection, actorId: string): Promise<Member> {
  const rows = await connection.query("SELECT * FROM app_members WHERE id = $1 AND active = TRUE", [actorId]);
  if (!rows.length) throw new ApiError(403, "Your tracker account is inactive.", "ACCOUNT_INACTIVE");
  return memberFromRow(rows[0]);
}

export async function requireLeader(connection: SqlConnection, actorId: string): Promise<Member> {
  const member = await activeMember(connection, actorId);
  if (member.role !== "ADMIN") throw new ApiError(403, "Only leaders can change the spending order.", "ADMIN_REQUIRED");
  return member;
}

export async function spendingSettings(connection: SqlConnection): Promise<SpendingSettings> {
  const rows = await connection.query("SELECT post_enabled, early_discord FROM spending_settings WHERE id = 'clan'");
  return { postEnabled: rows[0]?.post_enabled === true, earlyDiscord: rows[0]?.early_discord === true };
}

export async function loadContext(connection: SqlConnection, now: Date): Promise<Context> {
  const { week, warDay, nextWar } = orderWeek(now);
  const members = (await connection.query("SELECT * FROM app_members WHERE active = TRUE ORDER BY LOWER(COALESCE(NULLIF(display_name, ''), username)), id")).map(memberFromRow);
  const bankRows = await connection.query(`SELECT b.*, COALESCE(NULLIF(editor.display_name, ''), editor.username) AS updated_by_username
    FROM member_banks b JOIN app_members owner ON owner.id = b.member_id
    JOIN app_members editor ON editor.id = b.updated_by WHERE owner.active = TRUE`);
  const entries = bankRows.map((row) => entryFromRow({ ...row, id: `bank:${row.member_id}`, week_start: currentWeek(now) }));
  const { warRates: rates, warTech } = await getSettings(undefined, connection);
  const days = await clanDays(connection, week);
  // This week's answers on Home ("Planning to ascend (or push the new tiers) this week?").
  const ascensionRows = await connection.query("SELECT member_id, pillars FROM member_ascensions WHERE week_start = $1", [currentWeek(now)]);
  // The war's Days 1–5: snipes start just before a day's reset, so they fall inside that day.
  const from = dayStart(week, 1).toISOString();
  const to = dayStart(week, 6).toISOString();
  const snipeRows = await connection.query(
    "SELECT id, starts_at, activities FROM snipe_plans WHERE cancelled_at IS NULL AND starts_at >= $1 AND starts_at < $2", [from, to]);
  const inSnipe = await connection.query(`SELECT r.snipe_id, r.member_id FROM snipe_responses r JOIN snipe_plans p ON p.id = r.snipe_id
      WHERE r.answer = 'yes' AND p.cancelled_at IS NULL AND p.starts_at >= $1 AND p.starts_at < $2
    UNION SELECT a.snipe_id, a.member_id FROM snipe_attendance a JOIN snipe_plans p ON p.id = a.snipe_id
      WHERE p.cancelled_at IS NULL AND p.starts_at >= $1 AND p.starts_at < $2`, [from, to]);
  const snipes = snipeRows.map((row) => {
    const startsAt = new Date(iso(row.starts_at) ?? 0);
    return {
      id: String(row.id),
      startsAt,
      day: Math.floor((startsAt.getTime() - dayStart(week, 1).getTime()) / DAY) + 1,
      activities: jsonValue<WarActivity[]>(row.activities) ?? [],
      members: new Set(inSnipe.filter((item) => String(item.snipe_id) === String(row.id)).map((item) => String(item.member_id))),
    };
  });
  return {
    now, week, warDay, nextWar, clanDays: days, members, entries, rates, warTech,
    ascending: new Map(ascensionRows.map((row) => [String(row.member_id), parsePillars(String(row.pillars))])),
    snipes: snipes.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime()),
    early: await earlySpendsFor(connection, week),
    settings: await spendingSettings(connection),
  };
}

/** The first snipe on a clan day that scores with this line, if one is planned. */
export function lineSnipe(context: Context, day: number | null, resource: SpendResource): Context["snipes"][number] | null {
  if (day === null) return null;
  const activities = SPEND_INFO[resource].activities;
  return context.snipes.find((snipe) => snipe.day === day && snipe.activities.some((activity) => activities.includes(activity))) ?? null;
}

/**
 * Each line in the context. With `forDay`, every line is for that clan day (a day's Discord post);
 * otherwise each is for today or its next clan day.
 */
export function buildOrders(context: Context, forDay?: number): SpendOrder[] {
  return SPEND_RESOURCES.map((resource) => {
    const target = forDay !== undefined
      ? { day: forDay, today: !context.nextWar && forDay === context.warDay }
      : orderDay(resource, context.clanDays, context.warDay, context.nextWar);
    const activities = SPEND_INFO[resource].activities;
    const snipers = new Set<string>();
    if (target.day !== null) {
      for (const snipe of context.snipes) {
        if (snipe.day === target.day && snipe.activities.some((activity) => activities.includes(activity))) snipe.members.forEach((id) => snipers.add(id));
      }
    }
    // Holidays are checked against the day the line is for.
    const date = (target.day !== null ? dayStart(context.week, target.day) : context.now).toISOString().slice(0, 10);
    const early = new Set(context.early.filter((item) => item.status === "approved" && item.day === target.day && item.resource === resource).map((item) => item.member.id));
    const order = buildOrder({
      resource, members: context.members, entries: context.entries, rates: context.rates, boost: warBoost(context.warTech, target.day), ascending: context.ascending,
      snipers, early, date, day: target.day, today: target.today,
    });
    return { ...order, snipeAt: lineSnipe(context, target.day, resource)?.startsAt.toISOString() ?? null };
  });
}

/** The war's clan days whose post is up and not closed yet (the day before a clan day, there can be two). */
async function openPostDays(connection: SqlConnection, week: string): Promise<number[]> {
  const rows = await connection.query("SELECT war_day FROM spending_posts WHERE war_week = $1 AND closed_at IS NULL AND thread_id <> '' ORDER BY war_day", [week]);
  return rows.map((row) => Number(row.war_day));
}

/** The war's clan days that already have a post. */
async function postedDays(connection: SqlConnection, week: string): Promise<Set<number>> {
  const rows = await connection.query("SELECT war_day FROM spending_posts WHERE war_week = $1 AND thread_id <> ''", [week]);
  return new Set(rows.map((row) => Number(row.war_day)));
}

/**
 * Clan days whose post can go up now: tomorrow's (posts go up the day before, so members can talk
 * about the order), and today's if it never went up. On Day 7, tomorrow is the next war's Day 1.
 */
function dueDays(context: Context): number[] {
  const days: number[] = [];
  if (!context.nextWar && context.clanDays.includes(context.warDay)) days.push(context.warDay);
  const tomorrow = context.nextWar ? (context.warDay === 7 ? 1 : null) : context.warDay + 1;
  if (tomorrow !== null && tomorrow <= 5 && context.clanDays.includes(tomorrow)) days.push(tomorrow);
  return days.filter((day) => resourcesOnDay(day).length > 0);
}

/** Whether a clan day has started (it's today), rather than being tomorrow or later. */
function dayIsOn(context: Context, day: number): boolean {
  return !context.nextWar && day === context.warDay;
}

export function botToken(): string | null {
  return isDemo() ? null : process.env.DISCORD_BOT_TOKEN || null;
}
function channelId(): string {
  return process.env.DISCORD_SPENDING_CHANNEL_ID || SPENDING_CHANNEL_ID;
}

/** Everyone sees the lines; leaders also see the Discord post's state. */
export async function getSpendingOrder(actor: Member, db?: Database | SqlConnection, now = new Date()): Promise<SpendingOrderResponse> {
  const connection = db ?? await database();
  const me = await activeMember(connection, actor.id);
  const context = await loadContext(connection, now);
  return {
    week: context.week,
    warDay: context.warDay,
    nextWar: context.nextWar,
    clanDays: context.clanDays,
    orders: buildOrders(context),
    early: context.early,
    ...(me.role === "ADMIN" ? { post: { enabled: context.settings.postEnabled, configured: !!botToken() && !!channelId(), openDays: await openPostDays(connection, context.week), earlyDiscord: context.settings.earlyDiscord } } : {}),
  };
}

interface Dependencies { db?: Database; fetcher?: typeof fetch; now?: Date }

/** Leaders: whether the bot posts in #spending-order each clan day, and whether early spend requests show there. */
export async function updateSpendingSettings(actor: Member, input: { postEnabled?: boolean; earlyDiscord?: boolean }, dependencies: Dependencies = {}): Promise<SpendingOrderResponse> {
  const connection = dependencies.db ?? await database();
  const now = dependencies.now ?? new Date();
  const leader = await requireLeader(connection, actor.id);
  const current = await spendingSettings(connection);
  await connection.query(`INSERT INTO spending_settings (id, post_enabled, early_discord, updated_by, updated_at) VALUES ('clan', $1, $2, $3, $4)
    ON CONFLICT (id) DO UPDATE SET post_enabled = EXCLUDED.post_enabled, early_discord = EXCLUDED.early_discord, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`,
  [input.postEnabled ?? current.postEnabled, input.earlyDiscord ?? current.earlyDiscord, leader.id, now.toISOString()]);
  return getSpendingOrder(leader, connection, now);
}

/* ---------------------------------------------------------------------------------------------
 * The #spending-order forum post: one per clan day, names only (nobody is pinged), English only
 * (the server's translation bot does the rest). Opened the day before, so members can talk about
 * the order; updated with the order as it stands when the day starts (00:00 UTC); and closed and
 * archived when the day ends.
 * ------------------------------------------------------------------------------------------- */

export const RESOURCE_EMOJI: Record<SpendResource, string> = { skills: "🎟️", pets: "🥚", mounts: "🐎" };

/** Names exactly as written: Discord formatting characters are shown, not applied. */
export function plainName(name: string): string {
  return name.replace(/([\\*_~`|>#[\]()-])/g, "\\$1").replace(/@/g, "@\u200b");
}

/** "Day 3 – Skills and Pets · Thu 26 Nov" (forum post titles are at most 100 characters). */
export function spendingPostTitle(day: number, date: Date): string {
  const names = resourcesOnDay(day).map((resource) => SPEND_INFO[resource].label);
  const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0] ?? "";
  const when = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(date);
  return `Day ${day} – ${list} · ${when}`.slice(0, 100);
}

/** "00:00 UTC Tue 24 Nov" */
function utcStart(date: Date): string {
  return `00:00 UTC ${new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(date)}`;
}

/** The Hub's gold, so the post looks like the app. */
const EMBED_COLOR = 0xe6bd59;
/** Discord's limits: 1,024 characters a field, 25 fields, and 6,000 characters across the embed (some room kept). */
const FIELD_LIMIT = 1024;
const MAX_FIELDS = 25;
const EMBED_LIMIT = 5800;

/** War points kept short, as in the app: 1.9M, 64.2K. */
export function shortNumber(value: number): string {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(Math.round(value));
}

/** The app's "Ascend?" column in a few characters. */
function checkMark(check: AscendCheck): string {
  if (check.state === "ready") return ` · ✅ ${check.reaches}`;
  if (check.state === "short") return ` · ⏳ needs ${shortNumber(check.missing)}`;
  if (check.state === "level") return ` · 🔒 Lv ${check.level}`;
  return "";
}

function embedSize(embed: SpendingPostEmbed): number {
  return embed.author.name.length + embed.title.length + embed.description.length + embed.footer.length
    + embed.fields.reduce((total, field) => total + field.name.length + field.value.length, 0);
}

/** Lines packed into as few fields as fit: the first is named, the rest carry on without a name. */
function packFields(name: string, lines: string[]): { name: string; value: string }[] {
  const fields: { name: string; value: string }[] = [];
  let value = "";
  for (const line of lines) {
    if (value && value.length + 1 + line.length > FIELD_LIMIT) {
      fields.push({ name: fields.length ? "\u200b" : name, value });
      value = "";
    }
    value = value ? `${value}\n${line}` : line.slice(0, FIELD_LIMIT);
  }
  fields.push({ name: fields.length ? "\u200b" : name, value: value || "Nobody has any saved." });
  return fields;
}

/**
 * The post, like the app's table: each line that scores that day, with each member's place, name,
 * war points and ascend check. The whole order when it fits in one Discord embed; otherwise the top
 * of each line and how many more there are. With `starts`, the post is up before the day and says
 * when it starts; without, the day is on now.
 */
export function spendingPost(day: number, orders: SpendOrder[], hub: string, starts?: Date, ask?: { week: string }): { content: string; embed: SpendingPostEmbed } {
  const shown = orders.filter((order) => resourcesOnDay(day).includes(order.resource));
  const snipers = shown.some((order) => order.rows.some((row) => row.sniper && row.state === "line"));
  const ascenders = shown.some((order) => order.rows.some((row) => row.ascending && row.state === "line"));
  const early = shown.some((order) => order.rows.some((row) => row.early && row.state === "line"));
  const link = `${hub}/spending-order`;
  const write = (limit: number): SpendingPostEmbed => ({
    color: EMBED_COLOR,
    author: { name: "Turmoil Clan Hub", iconUrl: `${hub}/app-icons/icon-192.png`, url: link },
    title: `📋 Spending order – Day ${day} (clan day)`,
    url: link,
    description: [
      starts ? `Day ${day} starts ${utcStart(starts)}. The order updates when it starts.` : `Day ${day} is on now. Spend in this order.`,
      "🎯 Snipers first, then ⏫ ascending, then the biggest stockpiles (war points).",
    ].join("\n"),
    fields: shown.flatMap((order) => {
      const line = order.rows.filter((row) => row.state === "line");
      const lines = line.slice(0, limit).map((row) => `${row.place}. ${row.sniper ? "🎯 " : ""}${row.ascending ? "⏫ " : ""}${row.early ? "⏰ " : ""}${plainName(row.member.username)} · ${shortNumber(row.points)} pts${checkMark(row.check)}`);
      if (line.length > limit) lines.push(`+${line.length - limit} more on the Clan Hub`);
      return packFields(`${RESOURCE_EMOJI[order.resource]} ${SPEND_INFO[order.resource].label} · ${line.length} in line`, lines);
    }),
    footer: [
      "✅ ready to ascend", "⏳ not enough yet", "🔒 summon level under 100",
      ...(ascenders ? ["⏫ ascending this week"] : []), ...(snipers ? [`🎯 in the Day ${day} snipe`] : []),
      ...(early ? ["⏰ approved to spend early"] : []),
    ].join(" · "),
    button: { label: "Open the Spending Order", url: link },
    ...(ask ? { ask: { label: "Ask to spend early", customId: `early:ask:${ask.week}:${day}` } } : {}),
  });
  let embed = write(60);
  for (let limit = 55; limit >= 5 && (embedSize(embed) > EMBED_LIMIT || embed.fields.length > MAX_FIELDS); limit -= 5) embed = write(limit);
  return { content: "Find your place below, and ask questions here.", embed };
}

/** The post as Discord's API takes it. No pings (leadership asked for names only). */
function discordMessage(post: { content: string; embed: SpendingPostEmbed }) {
  const { embed } = post;
  return {
    content: post.content,
    embeds: [{
      color: embed.color,
      author: { name: embed.author.name, icon_url: embed.author.iconUrl, url: embed.author.url },
      title: embed.title,
      url: embed.url,
      description: embed.description,
      fields: embed.fields.slice(0, MAX_FIELDS).map((field) => ({ name: field.name, value: field.value, inline: false })),
      footer: { text: embed.footer },
    }],
    // A link button (style 5) opens the Hub; it needs nothing from the bot when tapped. With early spend
    // requests switched on, a second button asks the bot (see early-spend.ts).
    components: [{ type: 1, components: [
      { type: 2, style: 5, label: embed.button.label, url: embed.button.url },
      ...(embed.ask ? [{ type: 2, style: 2, label: embed.ask.label, emoji: { name: "⏰" }, custom_id: embed.ask.customId }] : []),
    ] }],
    allowed_mentions: { parse: [] },
  };
}

export async function discordReason(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { message?: unknown; code?: unknown } | null;
  if (typeof body?.message === "string") return typeof body.code === "number" ? `${body.message}, ${body.code}` : body.message;
  return `HTTP ${response.status}`;
}

interface PostDraft { day: number; week: string; title: string; content: string; embed: SpendingPostEmbed }

/** A clan day's post as it would go up now: before the day it says when it starts, on the day that it's on. */
export function draftFor(context: Context, day: number): PostDraft {
  const starts = dayStart(context.week, day);
  const post = spendingPost(day, buildOrders(context, day), appUrl(), dayIsOn(context, day) ? undefined : starts, context.settings.earlyDiscord ? { week: context.week } : undefined);
  return { day, week: context.week, title: spendingPostTitle(day, starts), ...post };
}

/**
 * The post leaders see in the preview: the next one due that isn't up yet, else the one that's up,
 * else the next clan day's (not due yet).
 */
async function previewFor(connection: SqlConnection, now: Date): Promise<{ draft: PostDraft | null; due: boolean; posted: boolean }> {
  const context = await loadContext(connection, now);
  const posted = await postedDays(connection, context.week);
  const due = dueDays(context);
  const from = context.nextWar ? 1 : context.warDay;
  const day = due.find((item) => !posted.has(item)) ?? due[0]
    ?? context.clanDays.find((item) => item >= from && resourcesOnDay(item).length > 0) ?? null;
  if (day === null) return { draft: null, due: false, posted: false };
  return { draft: draftFor(context, day), due: due.includes(day), posted: posted.has(day) };
}

/** Leaders: the post as it would look right now, before anything goes to Discord. */
export async function spendingPostPreview(actor: Member, db?: Database | SqlConnection, now = new Date()): Promise<SpendingPostPreview> {
  const connection = db ?? await database();
  await requireLeader(connection, actor.id);
  const { draft, due, posted } = await previewFor(connection, now);
  const settings = await spendingSettings(connection);
  return { day: draft?.day ?? null, due, title: draft?.title ?? "", content: draft?.content ?? "", embed: draft?.embed ?? null, enabled: settings.postEnabled, posted };
}

/** Opens a clan day's post. Returns false when it's already up (or another run is opening it). */
async function openPost(connection: SqlConnection, token: string, fetcher: typeof fetch, now: Date, draft: PostDraft, on: boolean): Promise<boolean> {
  const channel = channelId();
  if (!channel) return false;
  // Claim the day first, so two runs at once never open two posts. A post opened on its day needs no update when it starts.
  const claimed = await connection.query(`INSERT INTO spending_posts (war_week, war_day, channel_id, thread_id, opened_at, refreshed_at) VALUES ($1, $2, $3, '', $4, $5)
    ON CONFLICT (war_week, war_day) DO NOTHING RETURNING war_day`, [draft.week, draft.day, channel, now.toISOString(), on ? now.toISOString() : null]);
  if (!claimed.length) return false;
  try {
    const response = await fetcher(`${DISCORD_API}/channels/${channel}/threads`, {
      method: "POST",
      headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
      // Up to two days open, so Discord's own auto-archive is set past that (3 days); the job closes it when the day ends.
      body: JSON.stringify({ name: draft.title, auto_archive_duration: 4320, message: discordMessage(draft) }),
    });
    if (!response.ok) throw new ApiError(502, `Discord did not accept the post (${await discordReason(response)}).`, "SPENDING_POST_FAILED");
    const thread = (await response.json()) as { id?: unknown };
    if (!thread?.id) throw new ApiError(502, "Discord did not accept the post.", "SPENDING_POST_FAILED");
    await connection.query("UPDATE spending_posts SET thread_id = $3 WHERE war_week = $1 AND war_day = $2", [draft.week, draft.day, String(thread.id)]);
    return true;
  } catch (error) {
    await connection.query("DELETE FROM spending_posts WHERE war_week = $1 AND war_day = $2 AND thread_id = ''", [draft.week, draft.day]);
    throw error;
  }
}

/** Rewrites a post's first message (a forum post's first message has the post's id). */
export async function editPost(thread: string, draft: PostDraft, token: string, fetcher: typeof fetch): Promise<void> {
  const response = await fetcher(`${DISCORD_API}/channels/${thread}/messages/${thread}`, {
    method: "PATCH",
    headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
    // flags 0: posts from before the embed had embeds switched off, so switch them back on.
    body: JSON.stringify({ ...discordMessage(draft), flags: 0 }),
  });
  if (!response.ok) throw new ApiError(502, `Discord did not take the updated order (${await discordReason(response)}).`, "SPENDING_POST_FAILED");
}

/** When a clan day starts, its post (up since the day before) gets the order as it stands then: resources, holidays and snipes may have changed. */
async function refreshTodaysPost(connection: SqlConnection, token: string, fetcher: typeof fetch, context: Context): Promise<number | null> {
  if (context.nextWar) return null;
  const rows = await connection.query("SELECT thread_id FROM spending_posts WHERE war_week = $1 AND war_day = $2 AND thread_id <> '' AND closed_at IS NULL AND refreshed_at IS NULL",
    [context.week, context.warDay]);
  if (!rows.length) return null;
  await editPost(String(rows[0].thread_id), draftFor(context, context.warDay), token, fetcher);
  await connection.query("UPDATE spending_posts SET refreshed_at = $3 WHERE war_week = $1 AND war_day = $2", [context.week, context.warDay, context.now.toISOString()]);
  return context.warDay;
}

/** Archives and locks a post so the day's talk stays readable but closed. */
async function closeThread(threadId: string, token: string, fetcher: typeof fetch): Promise<boolean> {
  const headers = { Authorization: `Bot ${token}`, "Content-Type": "application/json", "X-Audit-Log-Reason": "Clan day over" };
  const locked = await fetcher(`${DISCORD_API}/channels/${threadId}`, { method: "PATCH", headers, body: JSON.stringify({ archived: true, locked: true }) }).catch(() => null);
  if (locked?.ok) return true;
  // Without Manage Threads the bot can still archive its own post.
  const archived = await fetcher(`${DISCORD_API}/channels/${threadId}`, { method: "PATCH", headers, body: JSON.stringify({ archived: true }) }).catch(() => null);
  return !!archived?.ok || archived?.status === 404 || locked?.status === 404;
}

/**
 * The job (vercel.json: just after 00:00 UTC, and again at 12:05 UTC for clan days picked late):
 * closes posts for days that have ended; then, when the post is switched on, updates the post for
 * the day that just started, and opens the posts that are due (tomorrow's, or today's if it never went up).
 */
export async function syncSpendingPosts(dependencies: Dependencies = {}): Promise<{ closed: number; refreshed: number | null; opened: number[]; skipped?: string }> {
  const token = botToken();
  if (!token) return { closed: 0, refreshed: null, opened: [], skipped: "not configured" };
  const connection = dependencies.db ?? await database();
  const now = dependencies.now ?? new Date();
  const fetcher = dependencies.fetcher ?? fetch;
  let closed = 0;
  const open = await connection.query("SELECT war_week::text AS week, war_day, thread_id FROM spending_posts WHERE closed_at IS NULL AND thread_id <> ''");
  for (const row of open) {
    const ends = dayStart(String(row.week).slice(0, 10), Number(row.war_day) + 1);
    if (ends.getTime() > now.getTime()) continue;
    if (await closeThread(String(row.thread_id), token, fetcher)) {
      await connection.query("UPDATE spending_posts SET closed_at = $3 WHERE war_week = $1 AND war_day = $2", [String(row.week).slice(0, 10), Number(row.war_day), now.toISOString()]);
      closed++;
    }
  }
  if (!(await spendingSettings(connection)).postEnabled) return { closed, refreshed: null, opened: [], skipped: "switched off" };
  const context = await loadContext(connection, now);
  // Each step on its own: one failing doesn't stop the rest, and the next run tries again.
  let failure: unknown = null;
  let refreshed: number | null = null;
  try { refreshed = await refreshTodaysPost(connection, token, fetcher, context); } catch (error) { failure = error; }
  const opened: number[] = [];
  for (const day of dueDays(context)) {
    try {
      if (await openPost(connection, token, fetcher, now, draftFor(context, day), dayIsOn(context, day))) opened.push(day);
    } catch (error) { failure ??= error; }
  }
  if (failure) {
    console.error("Spending order post:", failure);
    if (refreshed === null && !opened.length) throw failure;
  }
  return { closed, refreshed, opened };
}

/** Leaders: open the post that's due now (tomorrow's, or today's) instead of waiting for the job. */
export async function postSpendingNow(actor: Member, dependencies: Dependencies = {}): Promise<SpendingPostPreview> {
  const connection = dependencies.db ?? await database();
  const now = dependencies.now ?? new Date();
  await requireLeader(connection, actor.id);
  const token = botToken();
  if (!token || !channelId()) throw new ApiError(503, "The Discord post isn’t set up yet.", "SPENDING_POST_NOT_CONFIGURED");
  if (!(await spendingSettings(connection)).postEnabled) throw new ApiError(409, "Switch the Discord post on first.", "SPENDING_POST_OFF");
  const context = await loadContext(connection, now);
  const due = dueDays(context);
  if (!due.length) throw new ApiError(409, "There’s no clan day today or tomorrow, so there’s nothing to post yet.", "NOT_A_CLAN_DAY");
  const posted = await postedDays(connection, context.week);
  const day = due.find((item) => !posted.has(item));
  if (day === undefined || !(await openPost(connection, token, dependencies.fetcher ?? fetch, now, draftFor(context, day), dayIsOn(context, day)))) {
    throw new ApiError(409, "That day’s post is already up.", "SPENDING_POST_EXISTS");
  }
  return spendingPostPreview(actor, connection, now);
}

/** Leaders: rewrite the posts that are up with the order as it stands now. */
export async function updateSpendingPostsNow(actor: Member, dependencies: Dependencies = {}): Promise<SpendingPostPreview> {
  const connection = dependencies.db ?? await database();
  const now = dependencies.now ?? new Date();
  await requireLeader(connection, actor.id);
  const token = botToken();
  if (!token) throw new ApiError(503, "The Discord post isn’t set up yet.", "SPENDING_POST_NOT_CONFIGURED");
  const context = await loadContext(connection, now);
  const rows = await connection.query("SELECT war_day, thread_id FROM spending_posts WHERE war_week = $1 AND closed_at IS NULL AND thread_id <> '' ORDER BY war_day", [context.week]);
  if (!rows.length) throw new ApiError(409, "There’s no post up to update.", "NO_SPENDING_POST");
  for (const row of rows) {
    const day = Number(row.war_day);
    await editPost(String(row.thread_id), draftFor(context, day), token, dependencies.fetcher ?? fetch);
    // Once its day is on, the post has that day's order, so the start-of-day update isn't needed.
    if (dayIsOn(context, day)) await connection.query("UPDATE spending_posts SET refreshed_at = $3 WHERE war_week = $1 AND war_day = $2", [context.week, day, now.toISOString()]);
  }
  return spendingPostPreview(actor, connection, now);
}

/** The open post for a clan day (its thread), if it's up. */
export async function openPostThread(connection: SqlConnection, week: string, day: number): Promise<string | null> {
  const rows = await connection.query("SELECT thread_id FROM spending_posts WHERE war_week = $1 AND war_day = $2 AND closed_at IS NULL AND thread_id <> ''", [week, day]);
  return rows[0] ? String(rows[0].thread_id) : null;
}

/** Rewrites one clan day's post with the order as it stands now (e.g. after an early spend is approved). Quietly does nothing when it isn't up. */
export async function refreshDayPost(connection: SqlConnection, week: string, day: number, dependencies: { fetcher?: typeof fetch; now?: Date } = {}): Promise<boolean> {
  const token = botToken();
  if (!token) return false;
  const thread = await openPostThread(connection, week, day);
  if (!thread) return false;
  const context = await loadContext(connection, dependencies.now ?? new Date());
  if (context.week !== week) return false;
  await editPost(thread, draftFor(context, day), token, dependencies.fetcher ?? fetch);
  return true;
}
