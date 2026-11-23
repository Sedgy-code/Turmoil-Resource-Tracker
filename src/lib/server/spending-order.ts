import { currentWeek } from "../resources";
import { buildOrder, DEFAULT_TURNS, orderDay, orderWeek, resourcesOnDay, SPEND_INFO, SPEND_RESOURCES } from "../spending-order";
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

interface SpendingSettings { turns: Record<SpendResource, number>; postEnabled: boolean }

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
  done: { memberId: string; resource: SpendResource; doneBy: string; byName: string }[];
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
  const rows = await connection.query("SELECT turns, post_enabled FROM spending_settings WHERE id = 'clan'");
  const saved = rows.length ? jsonValue<Partial<Record<SpendResource, number>>>(rows[0].turns) ?? {} : {};
  const turns = Object.fromEntries(SPEND_RESOURCES.map((resource) => {
    const value = Number(saved[resource]);
    return [resource, Number.isInteger(value) && value >= 1 ? value : DEFAULT_TURNS];
  })) as Record<SpendResource, number>;
  return { turns, postEnabled: rows[0]?.post_enabled === true };
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
  const doneRows = await connection.query(`SELECT d.member_id, d.resource, d.done_by, COALESCE(NULLIF(m.display_name, ''), m.username) AS by_name
    FROM spending_done d JOIN app_members m ON m.id = d.done_by WHERE d.war_week = $1`, [week]);
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
    done: doneRows.map((row) => ({ memberId: String(row.member_id), resource: row.resource as SpendResource, doneBy: String(row.done_by), byName: String(row.by_name) })),
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
    const done = new Map(context.done.filter((item) => item.resource === resource)
      .map((item) => [item.memberId, item.doneBy === item.memberId ? null : item.byName]));
    // Holidays are checked against the day the line is for.
    const date = (target.day !== null ? dayStart(context.week, target.day) : context.now).toISOString().slice(0, 10);
    return buildOrder({
      resource, members: context.members, entries: context.entries, rates: context.rates, ascending: context.ascending,
      snipers, done, turns: context.settings.turns[resource], date, day: target.day, today: target.today,
    });
  });
}

async function openPostDay(connection: SqlConnection, week: string): Promise<number | null> {
  const rows = await connection.query("SELECT war_day FROM spending_posts WHERE war_week = $1 AND closed_at IS NULL AND thread_id <> '' ORDER BY war_day DESC LIMIT 1", [week]);
  return rows.length ? Number(rows[0].war_day) : null;
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
    ...(me.role === "ADMIN" ? { post: { enabled: context.settings.postEnabled, configured: !!botToken() && !!channelId(), openDay: await openPostDay(connection, context.week) } } : {}),
  };
}

interface Dependencies { db?: Database; fetcher?: typeof fetch; now?: Date }

/**
 * "I'm done" (or Undo) for one line in this war. Members mark themselves; leaders can mark anyone.
 * Today's Discord post is updated when the change is in one of its lines.
 */
export async function setSpendingDone(actor: Member, input: { resource: SpendResource; done: boolean; memberId?: string }, dependencies: Dependencies = {}): Promise<SpendingOrderResponse> {
  const connection = dependencies.db ?? await database();
  const now = dependencies.now ?? new Date();
  const me = await activeMember(connection, actor.id);
  const targetId = input.memberId ?? me.id;
  if (targetId !== me.id && me.role !== "ADMIN") throw new ApiError(403, "Only leaders can mark someone else as done.", "ADMIN_REQUIRED");
  const targets = await connection.query("SELECT * FROM app_members WHERE id = $1 AND active = TRUE", [targetId]);
  if (!targets.length) throw new ApiError(404, "This member could not be found.", "MEMBER_NOT_FOUND");
  const target = memberFromRow(targets[0]);
  const { week } = orderWeek(now);
  const before = buildOrders(await loadContext(connection, now)).find((order) => order.resource === input.resource);
  if (input.done) {
    await connection.query(`INSERT INTO spending_done (war_week, resource, member_id, done_by, done_at) VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (war_week, resource, member_id) DO NOTHING`, [week, input.resource, target.id, me.id, now.toISOString()]);
  } else {
    await connection.query("DELETE FROM spending_done WHERE war_week = $1 AND resource = $2 AND member_id = $3", [week, input.resource, target.id]);
  }
  const after = await getSpendingOrder(me, connection, now);
  await refreshTodaysPost(connection, { ...dependencies, now }, {
    name: target.username, resource: input.resource, done: input.done,
    before, after: after.orders.find((order) => order.resource === input.resource),
  }).catch((error) => console.error("Spending order post not updated", error));
  return after;
}

/** Leaders: turns at once for each line, and whether the bot posts in #spending-order each clan day. */
export async function updateSpendingSettings(actor: Member, input: { turns?: Partial<Record<SpendResource, number>>; postEnabled?: boolean }, dependencies: Dependencies = {}): Promise<SpendingOrderResponse> {
  const connection = dependencies.db ?? await database();
  const now = dependencies.now ?? new Date();
  const leader = await requireLeader(connection, actor.id);
  const current = await spendingSettings(connection);
  const turns = { ...current.turns, ...Object.fromEntries(Object.entries(input.turns ?? {}).filter(([, value]) => value !== undefined)) };
  const postEnabled = input.postEnabled ?? current.postEnabled;
  await connection.query(`INSERT INTO spending_settings (id, turns, post_enabled, updated_by, updated_at) VALUES ('clan', $1::jsonb, $2, $3, $4)
    ON CONFLICT (id) DO UPDATE SET turns = EXCLUDED.turns, post_enabled = EXCLUDED.post_enabled, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`,
  [JSON.stringify(turns), postEnabled, leader.id, now.toISOString()]);
  if (input.turns) await refreshTodaysPost(connection, { ...dependencies, now }).catch((error) => console.error("Spending order post not updated", error));
  return getSpendingOrder(leader, connection, now);
}

/* ---------------------------------------------------------------------------------------------
 * The #spending-order forum post: one per clan day, names only (nobody is pinged), English only
 * (the server's translation bot does the rest). Opened just after the day starts (00:00 UTC),
 * kept up to date as members finish, then closed and archived when the day ends.
 * ------------------------------------------------------------------------------------------- */

const RESOURCE_EMOJI: Record<SpendResource, string> = { skills: "🎟️", pets: "🥚", mounts: "🐎" };
const SHOW_NEXT = 6;
const SHOW_DONE = 12;

/** Names exactly as written: Discord formatting characters are shown, not applied. */
export function plainName(name: string): string {
  return name.replace(/([\\*_~`|>#[\]()-])/g, "\\$1").replace(/@/g, "@\u200b");
}

function nameList(names: string[], limit: number): string {
  const shown = names.slice(0, limit).join(", ");
  return names.length > limit ? `${shown} (+${names.length - limit} more)` : shown;
}

/** "Day 3 – Skills and Pets · Thu 26 Nov" (forum post titles are at most 100 characters). */
export function spendingPostTitle(day: number, date: Date): string {
  const names = resourcesOnDay(day).map((resource) => SPEND_INFO[resource].label);
  const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0] ?? "";
  const when = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(date);
  return `Day ${day} – ${list} · ${when}`.slice(0, 100);
}

/** The post's text: for each line that scores that day, whose turn it is, who's next and who's done. */
export function spendingPostContent(day: number, orders: SpendOrder[], link: string): string {
  const shown = orders.filter((order) => resourcesOnDay(day).includes(order.resource));
  const label = (row: SpendOrder["rows"][number]) => `${row.sniper ? "🎯 " : ""}${plainName(row.member.username)}`;
  const blocks = shown.map((order) => {
    const turn = order.rows.filter((row) => row.state === "turn").map(label);
    const next = order.rows.filter((row) => row.state === "wait").map(label);
    const done = order.rows.filter((row) => row.state === "done").map((row) => plainName(row.member.username));
    const lines = [`${RESOURCE_EMOJI[order.resource]} **${SPEND_INFO[order.resource].label}**`];
    if (!turn.length && !next.length) lines.push(done.length ? "Everyone has finished." : "Nobody has any saved.");
    if (turn.length) lines.push(`✅ Your turn (${order.turns} at once): ${turn.join(", ")}`);
    if (next.length) lines.push(`⏳ Next: ${nameList(next, SHOW_NEXT)}`);
    if (done.length) lines.push(`✔️ Done: ${nameList(done, SHOW_DONE)}`);
    return lines.join("\n");
  });
  const snipers = shown.some((order) => order.rows.some((row) => row.sniper && (row.state === "turn" || row.state === "wait")));
  const text = [
    `📋 **Spending order – Day ${day} (clan day)**`,
    "Go in this order. When you've finished, tap **I'm done** on the Clan Hub so the next person moves up. Ask questions here.",
    "",
    blocks.join("\n\n"),
    "",
    ...(snipers ? ["🎯 = in today's snipe, so they go first."] : []),
    `Full order and your place: ${link}`,
  ].join("\n");
  return text.length > 2000 ? `${text.slice(0, 1990)}…` : text;
}

/** The line posted in the thread when someone finishes (or a leader takes it back). */
export function doneUpdateMessage(name: string, resource: SpendResource, done: boolean, nowTurn: string[]): string {
  const label = SPEND_INFO[resource].label;
  const first = done ? `✅ **${plainName(name)}** is done with ${label}.` : `↩️ **${plainName(name)}** is back in the ${label} line.`;
  return nowTurn.length ? `${first} Your turn now: ${nowTurn.map((item) => `**${plainName(item)}**`).join(", ")}.` : first;
}

async function discordReason(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { message?: unknown; code?: unknown } | null;
  if (typeof body?.message === "string") return typeof body.code === "number" ? `${body.message}, ${body.code}` : body.message;
  return `HTTP ${response.status}`;
}

/** What today's post says (or the next clan day's, when today isn't one). */
async function previewFor(connection: SqlConnection, now: Date): Promise<{ day: number | null; today: boolean; title: string; content: string; week: string }> {
  const context = await loadContext(connection, now);
  const from = context.nextWar ? 1 : context.warDay;
  const day = context.clanDays.find((item) => item >= from && resourcesOnDay(item).length > 0) ?? null;
  if (day === null) return { day: null, today: false, title: "", content: "", week: context.week };
  const orders = buildOrders(context, day);
  return {
    day,
    today: !context.nextWar && day === context.warDay,
    title: spendingPostTitle(day, dayStart(context.week, day)),
    content: spendingPostContent(day, orders, `${appUrl()}/spending-order`),
    week: context.week,
  };
}

/** Leaders: the post as it would look right now, before anything goes to Discord. */
export async function spendingPostPreview(actor: Member, db?: Database, now = new Date()): Promise<SpendingPostPreview> {
  const connection = db ?? await database();
  await requireLeader(connection, actor.id);
  const preview = await previewFor(connection, now);
  const settings = await spendingSettings(connection);
  const posted = preview.today && preview.day !== null
    ? (await connection.query("SELECT 1 FROM spending_posts WHERE war_week = $1 AND war_day = $2 AND thread_id <> ''", [preview.week, preview.day])).length > 0
    : false;
  return { day: preview.day, today: preview.today, title: preview.title, content: preview.content, enabled: settings.postEnabled, posted };
}

/** Opens today's post when today is a clan day and it isn't up yet. Returns the day posted, or null. */
async function openTodaysPost(connection: SqlConnection, token: string, fetcher: typeof fetch, now: Date): Promise<number | null> {
  const preview = await previewFor(connection, now);
  if (!preview.today || preview.day === null) return null;
  const channel = channelId();
  if (!channel) return null;
  // Claim the day first, so two runs at once never open two posts.
  const claimed = await connection.query(`INSERT INTO spending_posts (war_week, war_day, channel_id, thread_id, opened_at) VALUES ($1, $2, $3, '', $4)
    ON CONFLICT (war_week, war_day) DO NOTHING RETURNING war_day`, [preview.week, preview.day, channel, now.toISOString()]);
  if (!claimed.length) return null;
  try {
    const response = await fetcher(`${DISCORD_API}/channels/${channel}/threads`, {
      method: "POST",
      headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
      // Nobody is pinged (leadership asked for names only); flags 4 = no link previews.
      body: JSON.stringify({ name: preview.title, auto_archive_duration: 1440, message: { content: preview.content, allowed_mentions: { parse: [] }, flags: 4 } }),
    });
    if (!response.ok) throw new ApiError(502, `Discord did not accept the post (${await discordReason(response)}).`, "SPENDING_POST_FAILED");
    const thread = (await response.json()) as { id?: unknown };
    if (!thread?.id) throw new ApiError(502, "Discord did not accept the post.", "SPENDING_POST_FAILED");
    await connection.query("UPDATE spending_posts SET thread_id = $3 WHERE war_week = $1 AND war_day = $2", [preview.week, preview.day, String(thread.id)]);
    return preview.day;
  } catch (error) {
    await connection.query("DELETE FROM spending_posts WHERE war_week = $1 AND war_day = $2 AND thread_id = ''", [preview.week, preview.day]);
    throw error;
  }
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
 * Brings today's open post up to date: the first message is rewritten with the current lines and,
 * when someone finished (or a leader took it back), one short line says who's up now.
 */
async function refreshTodaysPost(
  connection: SqlConnection,
  dependencies: Dependencies & { now: Date },
  change?: { name: string; resource: SpendResource; done: boolean; before?: SpendOrder; after?: SpendOrder },
): Promise<void> {
  const token = botToken();
  if (!token) return;
  const { week, warDay, nextWar } = orderWeek(dependencies.now);
  if (nextWar) return;
  const rows = await connection.query("SELECT thread_id FROM spending_posts WHERE war_week = $1 AND war_day = $2 AND closed_at IS NULL AND thread_id <> ''", [week, warDay]);
  if (!rows.length) return;
  if (change && !resourcesOnDay(warDay).includes(change.resource)) return;
  const thread = String(rows[0].thread_id);
  const fetcher = dependencies.fetcher ?? fetch;
  const headers = { Authorization: `Bot ${token}`, "Content-Type": "application/json" };
  const context = await loadContext(connection, dependencies.now);
  const content = spendingPostContent(warDay, buildOrders(context, warDay), `${appUrl()}/spending-order`);
  // A forum post's first message has the post's own id.
  await fetcher(`${DISCORD_API}/channels/${thread}/messages/${thread}`, { method: "PATCH", headers, body: JSON.stringify({ content, allowed_mentions: { parse: [] }, flags: 4 }) });
  if (!change) return;
  const before = new Set(change.before?.rows.filter((row) => row.state === "turn").map((row) => row.member.id) ?? []);
  const nowTurn = (change.after?.rows ?? []).filter((row) => row.state === "turn" && !before.has(row.member.id)).map((row) => row.member.username);
  await fetcher(`${DISCORD_API}/channels/${thread}/messages`, {
    method: "POST", headers,
    body: JSON.stringify({ content: doneUpdateMessage(change.name, change.resource, change.done, nowTurn), allowed_mentions: { parse: [] }, flags: 4 }),
  });
}

/**
 * The daily job (vercel.json, just after 00:00 UTC): closes posts for days that have ended, then
 * opens today's post when today is a clan day and the post is switched on.
 */
export async function syncSpendingPosts(dependencies: Dependencies = {}): Promise<{ closed: number; opened: number | null; skipped?: string }> {
  const token = botToken();
  if (!token) return { closed: 0, opened: null, skipped: "not configured" };
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
  if (!(await spendingSettings(connection)).postEnabled) return { closed, opened: null, skipped: "switched off" };
  return { closed, opened: await openTodaysPost(connection, token, fetcher, now) };
}

/** Leaders: open today's post straight away (switched on, a clan day, and not posted yet). */
export async function postSpendingNow(actor: Member, dependencies: Dependencies = {}): Promise<SpendingPostPreview> {
  const connection = dependencies.db ?? await database();
  const now = dependencies.now ?? new Date();
  await requireLeader(connection, actor.id);
  const token = botToken();
  if (!token || !channelId()) throw new ApiError(503, "The Discord post isn’t set up yet.", "SPENDING_POST_NOT_CONFIGURED");
  if (!(await spendingSettings(connection)).postEnabled) throw new ApiError(409, "Switch the Discord post on first.", "SPENDING_POST_OFF");
  const preview = await previewFor(connection, now);
  if (!preview.today) throw new ApiError(409, "Today isn’t a clan day, so there’s nothing to post.", "NOT_A_CLAN_DAY");
  const opened = await openTodaysPost(connection, token, dependencies.fetcher ?? fetch, now);
  if (opened === null) throw new ApiError(409, "Today’s post is already up.", "SPENDING_POST_EXISTS");
  return spendingPostPreview(actor, connection, now);
}

