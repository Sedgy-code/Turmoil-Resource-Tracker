"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Check, ChevronsUp, ExternalLink, Eye, EyeOff, Hand, Lock, LoaderCircle, RefreshCw, Send, Star, Target } from "lucide-react";
import { errorText } from "@/lib/error-text";
import { useLanguage } from "@/lib/i18n";
import { numberFormat } from "@/lib/resources";
import { ASCEND_LEVEL, SPEND_INFO, SPEND_RESOURCES } from "@/lib/spending-order";
import type { AscendCheck, DashboardResponse, SpendingOrderResponse, SpendingPostEmbed, SpendingPostPreview, SpendOrder, SpendResource, SpendRow } from "@/lib/types";
import { RankBadge } from "./contribution-cards";
import { TermHelp } from "./first-visit";
import { MemberAvatar, MemberName } from "./member-identity";
import { PILLAR_ICONS, RESOURCE_ICONS } from "./resource-icons";
import { useStackFold } from "./stack-fold";
import "./war-week.css";
import "./spending-order.css";

const PICKED_KEY = "turmoil-spending-line";

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, headers: { "Content-Type": "application/json", ...options?.headers }, cache: "no-store" });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((result as { error?: string }).error || "Please try again.");
  return result as T;
}

/** The spending order, kept fresh: every 30 seconds while the page is open and visible. */
function useSpendingOrder() {
  const [order, setOrder] = useState<SpendingOrderResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    try {
      setOrder(await request<SpendingOrderResponse>("/api/spending-order"));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);
  useEffect(() => {
    void load();
    const visible = () => { if (document.visibilityState === "visible") void load(); };
    const interval = setInterval(visible, 30_000);
    window.addEventListener("focus", visible);
    document.addEventListener("visibilitychange", visible);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", visible);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [load]);
  return { order, setOrder, failed, load };
}

/** Big numbers kept short in the narrow columns: 1.2M, 64.2K. */
function compact(value: number, language: string): string {
  return new Intl.NumberFormat(language, { notation: "compact", maximumFractionDigits: 1 }).format(Math.round(value));
}

/** The short "Ascend?" verdict for a table cell. */
function CheckBadge({ check }: { check: AscendCheck }) {
  const { t, language } = useLanguage();
  if (check.state === "none") return <span className="spend-check none">—</span>;
  if (check.state === "level") return <span className="spend-check level"><Lock size={12} aria-hidden="true" />{t("Level {level}/100", { level: check.level })}</span>;
  if (check.state === "ready") return <span className="spend-check ready"><Check size={13} aria-hidden="true" />{t("Ready")}<small>{t(check.reaches)}</small></span>;
  return <span className="spend-check short">{t("Needs {amount} more", { amount: compact(check.missing, language) })}{check.reaches && <small>{t("Enough for {rarity}.", { rarity: t(check.reaches) })}</small>}</span>;
}

/** Your own ascend check in a sentence, with your numbers. */
function CheckSentence({ check }: { check: AscendCheck }) {
  const { t } = useLanguage();
  if (check.state === "none") return null;
  if (check.state === "level") return <p className="spend-check-text level"><Lock size={14} aria-hidden="true" />{t("Reach summon level 100 to ascend (you’re at {level}).", { level: check.level })}</p>;
  if (check.state === "ready") return <p className="spend-check-text ready"><Check size={14} aria-hidden="true" />{t("Ready to ascend: you have {have}, and the official guide suggests {need} for you.", { have: numberFormat(check.have), need: numberFormat(check.need) })} {t("Enough for {rarity}.", { rarity: t(check.reaches) })}</p>;
  return <p className="spend-check-text short">{t("To ascend, the official guide suggests {need} for you. You have {have}.", { need: numberFormat(check.need), have: numberFormat(check.have) })}{check.reaches && <> {t("Enough for {rarity}.", { rarity: t(check.reaches) })}</>}</p>;
}

/** "For Day 3 (today)", "For Day 3", or no clan day yet. */
function dayLine(line: SpendOrder, t: ReturnType<typeof useLanguage>["t"]): string {
  if (line.day === null) return t("No clan day for this line yet.");
  return line.today ? t("For Day {day} (today)", { day: line.day }) : t("For Day {day}", { day: line.day });
}

/** Where you sit in this line, and whether you're ready to ascend. */
function YourPlace({ line, row }: { line: SpendOrder; row: SpendRow | undefined }) {
  const { t } = useLanguage();
  const inLine = line.rows.filter((item) => item.place !== null).length;
  const Picture = PILLAR_ICONS[SPEND_INFO[line.resource].pillar];
  if (!row) {
    return <section className="spend-you" aria-label={t("Your place")}>
      <Picture size={30} />
      <div>
        <strong>{t("You have nothing saved for this line.")}</strong>
        <Link className="home-link" href="/resources">{t("Update my resources")}</Link>
      </div>
    </section>;
  }
  return <section className={`spend-you state-${row.state}`} aria-label={t("Your place")}>
    <Picture size={30} />
    <div>
      <strong>{row.place !== null ? t("You’re #{place} of {count}", { place: row.place, count: inLine }) : t("You’re away, so you’re skipped.")}</strong>
      <CheckSentence check={row.check} />
    </div>
  </section>;
}

function LineTable({ line, meId }: { line: SpendOrder; meId: string }) {
  const { t, language } = useLanguage();
  const fold = useStackFold(meId);
  const info = SPEND_INFO[line.resource];
  return <div className="planning-table-wrap">
    <table className="planning-table stack-table spend-table">
      <caption className="planning-sr-only">{t("Spending order")}: {t(info.label)}</caption>
      <thead><tr>
        <th scope="col">#</th>
        <th scope="col">{t("Member")}</th>
        <th scope="col">{t("War points")}</th>
        <th scope="col">{t("Saved")}</th>
        <th scope="col">{t("Ascend?")}</th>
      </tr></thead>
      <tbody>
        {line.rows.map((row) => {
          const me = row.member.id === meId;
          return <tr key={row.member.id} {...fold.row(row.member.id, [me ? "row-me" : "", `spend-${row.state}`].filter(Boolean).join(" "))}>
            <td className="spend-place stack-hide">{row.place !== null ? <RankBadge rank={row.place} /> : "—"}</td>
            <th scope="row" className="stack-title">
              <span className="spend-member">
                {row.place !== null && <span className="stack-only spend-place-mark"><RankBadge rank={row.place} /></span>}
                <MemberAvatar member={row.member} small />
                <MemberName member={row.member} />
                {me && <span className="you-badge">{t("you")}</span>}
                {row.sniper && <Target size={15} className="spend-sniper" aria-label={t("In that day’s snipe")} role="img" />}
                {row.ascending && <ChevronsUp size={15} className="spend-ascending" aria-label={t("Planning to ascend")} role="img" />}
                {row.state === "away" && <span className="spend-tag away">{t("Away")}</span>}
              </span>
            </th>
            <td className="stack-key spend-points" data-label={t("War points")}>{compact(row.points, language)}</td>
            <td className="spend-amounts" data-label={t("Saved")}>
              {row.amounts.map(({ key, value }) => { const Icon = RESOURCE_ICONS[key]; return <span key={key} title={t(LABELS[key] ?? key)}><Icon size={16} />{numberFormat(value)}</span>; })}
            </td>
            <td className="spend-check-cell" data-label={t("Ascend?")}><CheckBadge check={row.check} /></td>
            {fold.toggleCell(row.member.id)}
          </tr>;
        })}
        {line.rows.length === 0 && <tr><td colSpan={5} className="planning-table-empty">{t("Nobody has any saved for this line.")}</td></tr>}
      </tbody>
    </table>
  </div>;
}

const LABELS: Partial<Record<string, string>> = {
  skillTickets: "Skill Tickets", eggsPetsTotal: "Total eggs/pets", eggshellsTotal: "Eggshells total", mountKeys: "Mount Keys", mountsToMerge: "Mounts to Merge",
};

/** The post as Discord shows it: **bold** in bold, and escaped characters as themselves. */
function DiscordText({ text }: { text: string }) {
  const plain = (value: string) => value.replace(/\\(.)/g, "$1").replace(/​/g, "");
  return <>{text.split(/(\*\*[^*]+\*\*)/g).map((part, index) => part.length > 4 && part.startsWith("**") && part.endsWith("**")
    ? <strong key={index}>{plain(part.slice(2, -2))}</strong>
    : plain(part))}</>;
}

/** The post as Discord draws it: the line above, then the embed card and its Open button. */
function EmbedPreview({ content, embed }: { content: string; embed: SpendingPostEmbed }) {
  return <div className="spend-discord">
    {content && <p className="spend-discord-content"><DiscordText text={content} /></p>}
    <div className="spend-embed" style={{ borderInlineStartColor: `#${embed.color.toString(16).padStart(6, "0")}` }}>
      <span className="spend-embed-author">
        {/* eslint-disable-next-line @next/next/no-img-element -- the same small icon Discord shows */}
        <img src={embed.author.iconUrl} alt="" width={20} height={20} />{embed.author.name}
      </span>
      <strong className="spend-embed-title">{embed.title}</strong>
      <p className="spend-embed-text"><DiscordText text={embed.description} /></p>
      {embed.fields.map((field, index) => <div key={index} className="spend-embed-field">
        {field.name !== "\u200b" && <strong>{field.name}</strong>}
        <p className="spend-embed-text"><DiscordText text={field.value} /></p>
      </div>)}
      <small className="spend-embed-footer">{embed.footer}</small>
    </div>
    <span className="spend-embed-button">{embed.button.label}<ExternalLink size={13} aria-hidden="true" /></span>
  </div>;
}

/** Leaders: switch the #spending-order post on or off, see exactly what it will say, post the next one now, or update the posts that are up. */
function PostPanel({ order, notify, onChange }: { order: SpendingOrderResponse; notify: (message: string, error?: boolean) => void; onChange: (next: SpendingOrderResponse) => void }) {
  const { t } = useLanguage();
  const [preview, setPreview] = useState<SpendingPostPreview | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const post = order.post!;
  const showPreview = useCallback(async () => {
    try { setPreview(await request<SpendingPostPreview>("/api/spending-order/post")); } catch (error) { notify(t(errorText(error)), true); }
  }, [notify, t]);
  // Load once so leaders see straight away whether a post is up (and can update it); refresh while the preview is open.
  useEffect(() => { void showPreview(); }, [showPreview]);
  useEffect(() => { if (open) void showPreview(); }, [open, showPreview, order]);
  async function toggle() {
    setBusy(true);
    try {
      onChange(await request<SpendingOrderResponse>("/api/spending-order", { method: "PUT", body: JSON.stringify({ postEnabled: !post.enabled }) }));
      notify(t(post.enabled ? "Daily post switched off." : "Daily post switched on."));
    } catch (error) { notify(t(errorText(error)), true); } finally { setBusy(false); }
  }
  async function updateNow() {
    setBusy(true);
    try {
      setPreview(await request<SpendingPostPreview>("/api/spending-order/post", { method: "PATCH", body: "{}" }));
      notify(t("The post now shows the latest order."));
    } catch (error) { notify(t(errorText(error)), true); } finally { setBusy(false); }
  }
  async function postNow() {
    setBusy(true);
    try {
      const posted = await request<SpendingPostPreview>("/api/spending-order/post", { method: "POST", body: "{}" });
      setPreview(posted);
      // The new post joins the list of posts that are up.
      onChange(await request<SpendingOrderResponse>("/api/spending-order"));
      notify(t("Day {day}’s post is up in #spending-order.", { day: posted.day ?? "" }));
    } catch (error) { notify(t(errorText(error)), true); } finally { setBusy(false); }
  }
  return <section className="planning-panel spend-post" aria-labelledby="spend-post-title">
    <div className="spend-post-head">
      <div>
        <h2 id="spend-post-title"><Send size={16} />{t("Daily post in #spending-order")}</h2>
        <p>{t("Each clan day’s post goes up the day before, so members can talk about it. It updates when the day starts (00:00 UTC) and closes when the day ends. Names only: nobody is pinged.")}</p>
        {!post.configured && <p className="planning-notice">{t("The #spending-order channel isn’t connected yet.")}</p>}
      </div>
      <div className="planning-tabs spend-switch" role="group" aria-label={t("Daily post in #spending-order")}>
        <button type="button" aria-pressed={post.enabled} disabled={busy || post.enabled} onClick={() => void toggle()}>{t("On")}</button>
        <button type="button" aria-pressed={!post.enabled} disabled={busy || !post.enabled} onClick={() => void toggle()}>{t("Off")}</button>
      </div>
    </div>
    <div className="planning-inline-actions spend-post-actions">
      <button type="button" className="planning-button planning-button-subtle" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? <EyeOff size={15} /> : <Eye size={15} />}{t(open ? "Hide preview" : "Show preview")}</button>
      {post.enabled && preview?.due && !preview.posted && <button type="button" className="planning-button" disabled={busy || !post.configured} onClick={() => void postNow()}>{busy ? <LoaderCircle size={15} className="spin" /> : <Send size={15} />}{t("Post Day {day} now", { day: preview.day ?? "" })}</button>}
      {/* Every post that's up, and one button to update them all: on a clan day, today's post can be updated while tomorrow's is still to post. */}
      {post.openDays.map((day) => <span key={day} className="planning-chip"><Check size={13} />{t("Day {day}’s post is up.", { day })}</span>)}
      {post.openDays.length > 0 && <button type="button" className="planning-button planning-button-subtle" disabled={busy || !post.configured} onClick={() => void updateNow()}>{busy ? <LoaderCircle size={15} className="spin" /> : <RefreshCw size={15} />}{t("Update the post")}</button>}
    </div>
    {open && (preview
      ? preview.day === null
        ? <p className="spend-post-empty">{t("No clan day to post for yet.")}</p>
        : <figure className="spend-post-preview">
          <figcaption>{t("Preview for Day {day}", { day: preview.day })}</figcaption>
          <strong>{preview.title}</strong>
          {preview.embed ? <EmbedPreview content={preview.content} embed={preview.embed} /> : <pre><DiscordText text={preview.content} /></pre>}
        </figure>
      : <p className="spend-post-empty"><LoaderCircle size={15} className="spin" /></p>)}
  </section>;
}

/** War → Spending order: who spends first on each clan day, where you stand, and whether you're ready to ascend. */
export function SpendingOrder({ data, notify }: { data: DashboardResponse; notify: (message: string, error?: boolean) => void }) {
  const { t } = useLanguage();
  const { order, setOrder, failed, load } = useSpendingOrder();
  const [picked, setPicked] = useState<SpendResource | null>(() => {
    try {
      const saved = window.localStorage.getItem(PICKED_KEY);
      return SPEND_RESOURCES.includes(saved as SpendResource) ? saved as SpendResource : null;
    } catch { return null; }
  });
  const me = data.currentUser;
  const admin = me.role === "ADMIN";
  if (!order) {
    return <section className="planning-panel planning-state" aria-live="polite">
      {failed ? <><h2>{t("The spending order couldn’t load.")}</h2><button type="button" className="planning-button" onClick={() => void load()}>{t("Try again")}</button></> : <><LoaderCircle size={24} className="spin" /><p>{t("Loading…")}</p></>}
    </section>;
  }
  // Open on today's line, else the next clan day's, else the one this phone picked last.
  const soonest = [...order.orders].sort((a, b) => Number(b.today) - Number(a.today) || (a.day ?? 9) - (b.day ?? 9))[0];
  const resource = picked ?? soonest.resource;
  const line = order.orders.find((item) => item.resource === resource) ?? order.orders[0];
  const myRow = line.rows.find((row) => row.member.id === me.id);
  function pick(next: SpendResource) {
    setPicked(next);
    try { window.localStorage.setItem(PICKED_KEY, next); } catch { /* private mode: this visit only */ }
  }

  // The banner: the same words as the War page.
  const clanToday = !order.nextWar && order.clanDays.includes(order.warDay);
  const next = order.clanDays.find((day) => day > order.warDay);
  const tone = order.nextWar ? (order.warDay === 6 ? "battle" : "claim") : !order.clanDays.length ? null : clanToday ? "on" : "hold";
  const main = order.nextWar
    ? t("This war’s spending is over. Here’s the order for the next war.")
    : !order.clanDays.length ? t("Leadership hasn’t picked the clan days yet. Check announcements before you spend.")
      : clanToday ? t("Day {day} is a clan day. Spend in this order.", { day: order.warDay })
        : t("Today is not a clan day: hold your resources.");
  const sub = order.nextWar
    ? order.clanDays.length ? t("Next war’s clan days: {days}.", { days: order.clanDays.map((day) => t("Day {day}", { day })).join(", ") }) : ""
    : order.clanDays.length && !clanToday ? next ? t("Next clan day: Day {day}.", { day: next }) : t("No more clan days this war.") : "";
  const BannerIcon = tone === "on" ? Star : tone === "hold" ? Hand : null;

  return <div className="war-week spend-page">
    <section className={`panel war-week-now spend-banner${tone ? ` tone-${tone}` : ""}`}>
      <div>
        <span className="war-week-kicker">{BannerIcon && <BannerIcon size={13} aria-hidden="true" />}{t("Today")} · {t("Day {day} of 7", { day: order.warDay })}</span>
        <p className="war-week-verdict">{main}<TermHelp term="spendingOrder" /></p>
        {sub && <p>{sub}</p>}
      </div>
    </section>

    <div className="spend-picker" role="group" aria-label={t("Pick a line")}>
      {order.orders.map((item) => {
        const Picture = PILLAR_ICONS[SPEND_INFO[item.resource].pillar];
        return <button key={item.resource} type="button" aria-pressed={item.resource === line.resource} onClick={() => pick(item.resource)}>
          <Picture size={26} />
          <span>{t(SPEND_INFO[item.resource].label)}</span>
          <small>{item.day === null ? "—" : item.today ? t("Today") : t("Day {day}", { day: item.day })}</small>
        </button>;
      })}
    </div>

    <section className="planning-panel spend-line" aria-labelledby="spend-line-title">
      <div className="spend-line-head">
        <h2 id="spend-line-title">{t(SPEND_INFO[line.resource].label)}</h2>
        <span className={`planning-chip${line.today ? " spend-today" : ""}`}>{dayLine(line, t)}</span>
      </div>
      <YourPlace line={line} row={myRow} />
      <LineTable line={line} meId={me.id} />
      <p className="planning-footnote spend-footnote">
        {t("Order: members in that day’s snipe first, then members ascending that pillar this week, then the biggest stockpile, counted in war points (the same estimate as the snipe planner).")}{" "}
        {t("Ascend? uses the official Forge Master Discord ascension guide (first ascension), with your own discount and extra chance from My Resources. Pillars unlock at summon level {level}.", { level: ASCEND_LEVEL })}
      </p>
    </section>

    {admin && order.post && <PostPanel order={order} notify={notify} onChange={setOrder} />}
  </div>;
}
