import { randomUUID } from "node:crypto";
import { appUrl, guildId } from "./config";
import type { SqlConnection } from "./db";
import { clanRoleId } from "./discord-sync";

/**
 * Applying to join Turmoil, all inside Discord:
 * 1. An admin runs /apply-setup in #📝-apply (public, read-only); the bot posts an Apply button there.
 * 2. A guest taps Apply (or runs /apply), fills in a short Discord form and agrees to the clan rules.
 * 3. The bot posts it in #📋-applications (Leadership only) with Accept / Decline buttons.
 * 4. An admin answers: the applicant gets a DM, and accepted players get the Turmoil role
 *    when the bot is allowed to give it.
 */

const DISCORD_API = "https://discord.com/api/v10";
const EPHEMERAL = 64;
export const APPLY_BUTTON_ID = "apply:open";
export const APPLY_FORM_ID = "apply:form";
const DECISION = /^apply:(accept|decline):([0-9a-f-]{36})$/;
/** #📋-applications: the private Leadership channel where applications arrive. */
export const APPLICATIONS_CHANNEL_ID = "1560839494612295741";

/** What every member commits to. Shown on the Apply post; applicants must type "I agree". */
export const CLAN_RULES = [
  "📊 Join the Clan Hub (our resource tracker) and update your resources every week",
  "⚔️ Spend resources only on Clan War days. Spending outside them earns a black mark",
  "🧪 Put Clan Tech Vials first in clan missions. They power the whole clan’s progress",
  "🤝 Play as a team. Players who put their own progress first will be removed",
];

const FIELDS = [
  { id: "game_name", label: "In-game name", style: 1, max: 40, required: true, placeholder: "Exactly as it shows in Forge Master" },
  { id: "power", label: "Power", style: 1, max: 20, required: true, placeholder: "e.g. 25B" },
  { id: "server", label: "Server", style: 1, max: 20, required: true, placeholder: "e.g. 27" },
  { id: "about", label: "Languages and anything else about you", style: 2, max: 500, required: false, placeholder: "e.g. English and Chinese, online every day" },
  { id: "agree", label: "Type I AGREE to accept our clan rules", style: 1, max: 20, required: true, placeholder: "I agree" },
] as const;

/** "I agree", "yes i agree", "AGREE" count; "I don't agree" or "disagree" don't. */
export function agreesToRules(answer: string): boolean {
  const words = answer.toLowerCase().replace(/[^a-z\s']/g, " ");
  return /\bagree\b/.test(words) && !/\b(dis|not|don't|dont|no)\b|disagree/.test(words);
}
type FieldId = (typeof FIELDS)[number]["id"];

export type ApplyInteraction = {
  type: number;
  member?: { user?: DiscordUser; nick?: string | null };
  user?: DiscordUser;
  message?: { content?: string };
  data?: { name?: string; custom_id?: string; components?: { components?: { custom_id?: string; value?: string }[] }[] };
};
type DiscordUser = { id?: string; username?: string; global_name?: string | null };

const ephemeral = (content: string) => ({ type: 4, data: { content, flags: EPHEMERAL, allowed_mentions: { parse: [] } } });

/** The message /apply-setup posts: four languages, so guests don't need to translate it. */
export function applyMessage() {
  return {
    content: [
      "📝 **Want to join Turmoil?**",
      "Tap **Apply** below and fill in the short form. Leadership will reply to you here on Discord.",
      "",
      "**By applying, you agree to:**",
      ...CLAN_RULES,
      "",
      "**Requirements:** 20B+ power · play every war day",
      "",
      "🇹🇼 想加入 Turmoil？點下方 **Apply** 填寫簡短表單。",
      "🇨🇳 想加入 Turmoil？点下方 **Apply** 填写简短表格。",
      "🇰🇷 Turmoil에 가입하고 싶다면 아래 **Apply**를 눌러 짧은 양식을 작성하세요.",
    ].join("\n"),
    allowed_mentions: { parse: [] },
    components: [{ type: 1, components: [{ type: 2, style: 1, label: "Apply", emoji: { name: "📝" }, custom_id: APPLY_BUTTON_ID }] }],
  };
}

function applyForm() {
  return {
    type: 9,
    data: {
      custom_id: APPLY_FORM_ID,
      title: "Apply to Turmoil",
      components: FIELDS.map((field) => ({
        type: 1,
        components: [{ type: 4, custom_id: field.id, label: field.label, style: field.style, max_length: field.max, required: field.required, placeholder: field.placeholder }],
      })),
    },
  };
}

/** Apply button or /apply: the form, unless they're already in or already waiting. */
export async function openApplyForm(connection: SqlConnection, discordId: string) {
  const members = await connection.query("SELECT 1 FROM app_members WHERE discord_id = $1 AND active = TRUE", [discordId]);
  if (members.length) return ephemeral("You’re already in Turmoil. 🙂");
  const waiting = await connection.query("SELECT 1 FROM discord_applications WHERE discord_id = $1 AND status = 'pending' AND message_id IS NOT NULL LIMIT 1", [discordId]);
  if (waiting.length) return ephemeral("You’ve already applied. Leadership will reply to you here on Discord soon.");
  return applyForm();
}

function formValues(interaction: ApplyInteraction): Record<FieldId, string> {
  const values = Object.fromEntries(FIELDS.map((field) => [field.id, ""])) as Record<FieldId, string>;
  for (const row of interaction.data?.components ?? [])
    for (const input of row.components ?? []) {
      const field = FIELDS.find((candidate) => candidate.id === input.custom_id);
      if (field) values[field.id] = String(input.value ?? "").trim().slice(0, field.max);
    }
  return values;
}

function displayName(user: DiscordUser | undefined, nick?: string | null): string {
  return String(nick || user?.global_name || user?.username || "").slice(0, 100);
}

function leadershipMessage(id: string, discordId: string, name: string, values: Record<FieldId, string>) {
  return {
    content: [
      `📝 **New application** · <@${discordId}>${name ? ` (${name})` : ""}`,
      `**In-game name:** ${values.game_name}`,
      `**Power:** ${values.power}`,
      `**Server:** ${values.server}`,
      `**About:** ${values.about || "—"}`,
      "**Clan rules:** ✅ agreed",
    ].join("\n"),
    allowed_mentions: { parse: [] },
    components: [{
      type: 1,
      components: [
        { type: 2, style: 3, label: "Accept", emoji: { name: "✅" }, custom_id: `apply:accept:${id}` },
        { type: 2, style: 4, label: "Decline", emoji: { name: "✖️" }, custom_id: `apply:decline:${id}` },
      ],
    }],
  };
}

/** The form came back: save it, show it to leadership, and thank the applicant. */
export async function submitApplication(connection: SqlConnection, interaction: ApplyInteraction, discordId: string, fetcher: typeof fetch = fetch) {
  const values = formValues(interaction);
  if (!values.game_name) return ephemeral("Please add your in-game name and try again.");
  if (!agreesToRules(values.agree))
    return ephemeral("To join Turmoil you need to agree to our clan rules. Tap **Apply** again and type **I agree** in the last box.");
  const user = interaction.member?.user ?? interaction.user;
  const name = displayName(user, interaction.member?.nick);
  const id = randomUUID();
  await connection.query(
    `INSERT INTO discord_applications (id, discord_id, discord_name, game_name, power, server, about, agreed)
     VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)`,
    [id, discordId, name, values.game_name, values.power, values.server, values.about],
  );
  const token = process.env.DISCORD_BOT_TOKEN;
  const channel = process.env.DISCORD_APPLICATIONS_CHANNEL_ID || APPLICATIONS_CHANNEL_ID;
  const posted = token
    ? await fetcher(`${DISCORD_API}/channels/${channel}/messages`, {
        method: "POST",
        headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(leadershipMessage(id, discordId, name, values)),
      }).catch(() => null)
    : null;
  if (!posted?.ok) {
    console.warn("Application could not be posted for leadership", posted?.status);
    return ephemeral("Sorry, your application couldn’t be sent. Please message a Turmoil leader.");
  }
  const message = (await posted.json().catch(() => ({}))) as { id?: unknown };
  await connection.query("UPDATE discord_applications SET message_id = $2 WHERE id = $1", [id, String(message.id ?? "sent")]);
  return ephemeral([
    `✅ Thanks, ${values.game_name}! Your application is in. Leadership will reply to you here on Discord.`,
    "🇹🇼 謝謝！已收到你的申請，管理層會在 Discord 回覆你。",
    "🇨🇳 谢谢！已收到你的申请，管理层会在 Discord 回复你。",
    "🇰🇷 감사합니다! 신청서가 접수되었습니다. 운영진이 Discord로 답장드릴게요.",
  ].join("\n"));
}

async function sendDirectMessage(token: string, discordId: string, content: string, fetcher: typeof fetch): Promise<boolean> {
  const headers = { Authorization: `Bot ${token}`, "Content-Type": "application/json" };
  const opened = await fetcher(`${DISCORD_API}/users/@me/channels`, { method: "POST", headers, body: JSON.stringify({ recipient_id: discordId }) }).catch(() => null);
  if (!opened?.ok) return false;
  const dm = (await opened.json().catch(() => ({}))) as { id?: unknown };
  if (!dm.id) return false;
  const sent = await fetcher(`${DISCORD_API}/channels/${dm.id}/messages`, { method: "POST", headers, body: JSON.stringify({ content, allowed_mentions: { parse: [] } }) }).catch(() => null);
  return Boolean(sent?.ok);
}

async function giveClanRole(token: string, discordId: string, fetcher: typeof fetch): Promise<boolean> {
  const role = await clanRoleId(token, fetcher).catch(() => null);
  if (!role || !guildId()) return false;
  const given = await fetcher(`${DISCORD_API}/guilds/${encodeURIComponent(guildId())}/members/${discordId}/roles/${role}`, {
    method: "PUT",
    headers: { Authorization: `Bot ${token}`, "X-Audit-Log-Reason": "Turmoil application accepted" },
  }).catch(() => null);
  return Boolean(given?.ok);
}

export function isApplicationDecision(customId: string | undefined): boolean {
  return DECISION.test(customId ?? "");
}

/** Accept or Decline in the leadership channel (admins only). */
export async function decideApplication(connection: SqlConnection, interaction: ApplyInteraction, discordId: string, fetcher: typeof fetch = fetch) {
  const [, choice, id] = DECISION.exec(interaction.data?.custom_id ?? "") ?? [];
  const admins = await connection.query("SELECT username FROM app_members WHERE discord_id = $1 AND active = TRUE AND role = 'ADMIN'", [discordId]);
  if (!admins.length) return ephemeral("Only clan admins can answer applications.");
  const status = choice === "accept" ? "accepted" : "declined";
  const decidedBy = String(admins[0].username).slice(0, 100);
  const rows = await connection.query(
    `UPDATE discord_applications SET status = $2, decided_at = NOW(), decided_by = $3
     WHERE id = $1 AND status = 'pending' RETURNING discord_id, game_name`,
    [id, status, decidedBy],
  );
  if (!rows.length) {
    const existing = await connection.query("SELECT status, decided_by FROM discord_applications WHERE id = $1", [id]);
    return ephemeral(existing.length ? `Already ${existing[0].status} by ${existing[0].decided_by}.` : "This application can’t be found any more.");
  }
  const applicant = String(rows[0].discord_id);
  const token = process.env.DISCORD_BOT_TOKEN;
  const notes: string[] = [];
  if (token && status === "accepted") notes.push((await giveClanRole(token, applicant, fetcher)) ? "Turmoil role given" : "⚠️ couldn’t give the Turmoil role, please add it by hand");
  const dm = status === "accepted"
    ? [
        "🎉 **Welcome to Turmoil!** Your application was accepted. A leader will invite you in game soon.",
        `Sign in to our Clan Hub with Discord and save your resources: ${appUrl()}`,
        "Remember: spend only on Clan War days, put Clan Tech Vials first in clan missions, and play as a team.",
        "***The Turmoil Way.***",
      ].join("\n")
    : "Thanks for applying to **Turmoil**. We can’t take you in right now, but you’re welcome to apply again later. Good luck out there! ⚔️";
  if (token) notes.push((await sendDirectMessage(token, applicant, dm, fetcher)) ? "DM sent" : "⚠️ couldn’t DM them (their DMs are closed)");
  const verdict = status === "accepted" ? `✅ **Accepted** by ${decidedBy}` : `✖️ **Declined** by ${decidedBy}`;
  const original = interaction.message?.content || `📝 Application from <@${applicant}> (${rows[0].game_name})`;
  // Type 7 replaces the leadership message, so the buttons disappear once answered.
  return { type: 7, data: { content: `${original}\n\n${[verdict, ...notes].join(" · ")}`, components: [], allowed_mentions: { parse: [] } } };
}
