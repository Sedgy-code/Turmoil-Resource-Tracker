import { currentWeek } from "../resources";
import { buildOrder, orderDay, orderWeek, resourcesOnDay, SPEND_INFO, SPEND_RESOURCES } from "../spending-order";
import type { AscensionPillar, Member, ResourceEntry, SpendingOrderResponse, SpendingPostPreview, SpendOrder, SpendResource, WarActivity, WarRates } from "../types";
import { parsePillars } from "./ascensions";
import { appUrl, isDemo } from "./config";
import { database, type Database, type SqlConnection } from "./db";
import { ApiError } from "./errors";
import { entryFromRow, iso, memberFromRow } from "./mappers";
import { getSettings } from "./settings";
import { clanDays } from "./war-days";

const DAY = 86_400_000;
const DISCORD_API = "https://discord.com/api/v10";
/** #📋-spending-order, a forum channel in the Turmoil server (DISCORD_SPENDING_CHANNEL_ID overrides it). */
export const SPENDING_CHANNEL_ID = "1574254432357584898";

interface SpendingSettings { postEnabled: boolean }

interface Context {
  now: Date;
  week: string;
  warDay: number;
  nextWar: boolean;
  clanDays: number[];
  members: Member[];
  entries: ResourceEntry[];
  rates: WarRates;
  ascending: Map<string, AscensionPillar[]>;
  /** Snipes in that war (not cancelled): the war day each is on, what it scores with, and who's in it. */
  snipes: { day: number; activities: WarActivity[]; members: Set<string> }[];
  settings: SpendingSettings;
}

function jsonValue<T>(value: unknown): T {
  return (typeof value === "string" ? JSON.parse(value) : value) as T;
}

/** 00:00 UTC on a war day: Day 1 is the Tuesday after the war's Monday. */
function dayStart(week: string, day: number): Date {
  return new Date(Date.parse(`${week}T00:00:00Z`) + day * DAY);
}

async function activeMember(connection: SqlConnection, actorId: string): Promise<Member> {
  const rows = await connection.query("SELECT * FROM app_members WHERE id = $1 AND active = TRUE", [actorId]);
  if (!rows.length) throw new ApiError(403, "Your tracker account is inactive.", "ACCOUNT_INACTIVE");
  return memberFromRow(rows[0]);
}

async function requireLeader(connection: SqlConnection, actorId: string): Promise<Member> {
  const member = await activeMember(connection, actorId);
  if (member.role !== "ADMIN") throw new ApiError(403, "Only leaders can change the spending order.", "ADMIN_REQUIRED");
  return member;
}

export async function spendingSettings(connection: SqlConnection): Promise<SpendingSettings> {
  const rows = await connection.query("SELECT post_enabled FROM spending_settings WHERE id = 'clan'");
  return { postEnabled: rows[0]?.post_enabled === true };
}

async function loadContext(connection: SqlConnection, now: Date): Promise<Context> {
  const { week, warDay, nextWar } = orderWeek(now);
  const members = (await connection.query("SELECT * FROM app_members WHERE active = TRUE ORDER BY LOWER(COALESCE(NULLIF(display_name, ''), username)), id")).map(memberFromRow);
  const bankRows = await connection.query(`SELECT b.*, COALESCE(NULLIF(editor.display_name, ''), editor.username) AS updated_by_username
    FROM member_banks b JOIN app_members owner ON owner.id = b.member_id
    JOIN app_members editor ON editor.id = b.updated_by WHERE owner.active = TRUE`);
  const entries = bankRows.map((row) => entryFromRow({ ...row, id: `bank:${row.member_id}`, week_start: currentWeek(now) }));
  const rates = (await getSettings(undefined, connection)).warRates;
  const days = await clanDays(connection, week);
  // This week's answers on Home ("Planning to ascend this week?").
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
      day: Math.floor((startsAt.getTime() - dayStart(week, 1).getTime()) / DAY) + 1,
      activities: jsonValue<WarActivity[]>(row.activities) ?? [],
      members: new Set(inSnipe.filter((item) => String(item.snipe_id) === String(row.id)).map((item) => String(item.member_id))),
    };
  });
  return {
    now, week, warDay, nextWar, clanDays: days, members, entries, rates,
    ascending: new Map(ascensionRows.map((row) => [String(row.member_id), parsePillars(String(row.pillars))])),
    snipes,
    settings: await spendingSettings(connection),
  };
}

/**
 * Each line in the context. With `forDay`, every line is for that clan day (a day's Discord post);
 * otherwise each is for today or its next clan day.
 */
function buildOrders(context: Context, forDay?: number): SpendOrder[] {
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
    return buildOrder({
      resource, members: context.members, entries: context.entries, rates: context.rates, ascending: context.ascending,
      snipers, date, day: target.day, today: target.today,
    });
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

function botToken(): string | null {
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
    ...(me.role === "ADMIN" ? { post: { enabled: context.settings.postEnabled, configured: !!botToken() && !!channelId(), openDays: await openPostDays(connection, context.week) } } : {}),
  };
}

interface Dependencies { db?: Database; fetcher?: typeof fetch; now?: Date }

/** Leaders: whether the bot posts in #spending-order each clan day. */
export async function updateSpendingSettings(actor: Member, input: { postEnabled: boolean }, dependencies: Dependencies = {}): Promise<SpendingOrderResponse> {
  const connection = dependencies.db ?? await database();
  const now = dependencies.now ?? new Date();
  const leader = await requireLeader(connection, actor.id);
  await connection.query(`INSERT INTO spending_settings (id, post_enabled, updated_by, updated_at) VALUES ('clan', $1, $2, $3)
    ON CONFLICT (id) DO UPDATE SET post_enabled = EXCLUDED.post_enabled, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`,
  [input.postEnabled, leader.id, now.toISOString()]);
  return getSpendingOrder(leader, connection, now);
}

/* ---------------------------------------------------------------------------------------------
 * The #spending-order forum post: one per clan day, names only (nobody is pinged), English only
 * (the server's translation bot does the rest). Opened the day before, so members can talk about
 * the order; updated with the order as it stands when the day starts (00:00 UTC); and closed and
 * archived when the day ends.
 * ------------------------------------------------------------------------------------------- */

const RESOURCE_EMOJI: Record<SpendResource, string> = { skills: "🎟️", pets: "🥚", mounts: "🐎" };
/** Discord messages are capped at 2,000 characters. */
const POST_LIMIT = 2000;

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

/**
 * The post's text: each line that scores that day, numbered, biggest stockpile first. The whole order
 * when it fits in one Discord message; otherwise the top of each line and how many more there are.
 * With `starts`, the post is up before the day and says when it starts; without, the day is on now.
 */
export function spendingPostContent(day: number, orders: SpendOrder[], link: string, starts?: Date): string {
  const shown = orders.filter((order) => resourcesOnDay(day).includes(order.resource));
  const snipers = shown.some((order) => order.rows.some((row) => row.sniper && row.state === "line"));
  const write = (limit: number) => {
    const blocks = shown.map((order) => {
      const line = order.rows.filter((row) => row.state === "line");
      const lines = [`${RESOURCE_EMOJI[order.resource]} **${SPEND_INFO[order.resource].label}**`];
      if (!line.length) lines.push("Nobody has any saved.");
      line.slice(0, limit).forEach((row) => lines.push(`${row.place}. ${row.sniper ? "🎯 " : ""}${plainName(row.member.username)}`));
      if (line.length > limit) lines.push(`+${line.length - limit} more on the Clan Hub`);
      return lines.join("\n");
    });
    return [
      `📋 **Spending order – Day ${day} (clan day)**`,
      starts ? `Day ${day} starts ${utcStart(starts)}. The order updates when it starts.` : `Day ${day} is on now. Spend in this order.`,
      "Biggest stockpiles first. Find your place, and ask questions here.",
      "",
      blocks.join("\n\n"),
      "",
      ...(snipers ? [`🎯 = in the Day ${day} snipe, so they go first.`] : []),
      `Full order and your place: ${link}`,
    ].join("\n");
  };
  for (let limit = 60; limit > 5; limit -= 5) {
    const text = write(limit);
    if (text.length <= POST_LIMIT) return text;
  }
  const text = write(5);
  return text.length > POST_LIMIT ? `${text.slice(0, POST_LIMIT - 1)}…` : text;
}

async function discordReason(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { message?: unknown; code?: unknown } | null;
  if (typeof body?.message === "string") return typeof body.code === "number" ? `${body.message}, ${body.code}` : body.message;
  return `HTTP ${response.status}`;
}

interface PostDraft { day: number; week: string; title: string; content: string }

/** A clan day's post as it would go up now: before the day it says when it starts, on the day that it's on. */
function draftFor(context: Context, day: number): PostDraft {
  const starts = dayStart(context.week, day);
  return {
    day,
    week: context.week,
    title: spendingPostTitle(day, starts),
    content: spendingPostContent(day, buildOrders(context, day), `${appUrl()}/spending-order`, dayIsOn(context, day) ? undefined : starts),
  };
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
  return { day: draft?.day ?? null, due, title: draft?.title ?? "", content: draft?.content ?? "", enabled: settings.postEnabled, posted };
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
      // Nobody is pinged (leadership asked for names only); flags 4 = no link previews. Up to two days
      // open, so Discord's own auto-archive is set past that (3 days); the job closes it when the day ends.
      body: JSON.stringify({ name: draft.title, auto_archive_duration: 4320, message: { content: draft.content, allowed_mentions: { parse: [] }, flags: 4 } }),
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

/**
 * When a clan day starts, its post (up since the day before) gets the order as it stands then:
 * resources, holidays and snipes may have changed. A forum post's first message has the post's id.
 */
async function refreshTodaysPost(connection: SqlConnection, token: string, fetcher: typeof fetch, context: Context): Promise<number | null> {
  if (context.nextWar) return null;
  const rows = await connection.query("SELECT thread_id FROM spending_posts WHERE war_week = $1 AND war_day = $2 AND thread_id <> '' AND closed_at IS NULL AND refreshed_at IS NULL",
    [context.week, context.warDay]);
  if (!rows.length) return null;
  const thread = String(rows[0].thread_id);
  const draft = draftFor(context, context.warDay);
  const response = await fetcher(`${DISCORD_API}/channels/${thread}/messages/${thread}`, {
    method: "PATCH",
    headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ content: draft.content, allowed_mentions: { parse: [] }, flags: 4 }),
  });
  if (!response.ok) throw new ApiError(502, `Discord did not take the updated order (${await discordReason(response)}).`, "SPENDING_POST_FAILED");
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
