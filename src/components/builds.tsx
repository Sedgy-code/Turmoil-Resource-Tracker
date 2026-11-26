"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Archive, ChevronDown, ExternalLink, LoaderCircle, Plus, RefreshCw, Trash2 } from "lucide-react";
import {
  gameName, mountName, petName, pieceKey, skillName, statName, BUILDS_PAGE_URL, DISCORD_BUILD_GUIDE_URL,
  type Build, type BuildGoal, type BuildPiece, type BuildSnapshot, type BuildSnapshotResponse, type BuildsEmbed, type BuildsResponse,
} from "@/lib/builds";
import { useLanguage, localeFor, type Translate } from "@/lib/i18n";
import "./builds.css";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init, headers: { "Content-Type": "application/json" } });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "Something went wrong. Please try again.");
  return result as T;
}

const GOALS: Record<BuildGoal, { emoji: string; label: string; about: string }> = {
  arena: { emoji: "⚔️", label: "Arena & PvP", about: "Wins the most simulated arena fights against the other top builds." },
  quest: { emoji: "🗺️", label: "Main Quest", about: "Gets furthest in the main quest." },
  dpsMelee: { emoji: "🗡️", label: "Melee damage", about: "Most damage per second with a melee weapon." },
  dpsRanged: { emoji: "🏹", label: "Ranged damage", about: "Most damage per second with a ranged weapon." },
  healing: { emoji: "💚", label: "Healing", about: "Most healing per second, from regen, lifesteal and skills." },
};

/** "**Skills:** …" lines as Discord shows them. */
function DiscordText({ text }: { text: string }) {
  return <>{text.split(/(\*\*[^*]+\*\*)/g).map((part, index) => (part.length > 4 && part.startsWith("**") && part.endsWith("**")
    ? <strong key={index}>{part.slice(2, -2)}</strong>
    : part))}</>;
}

function useDate() {
  const { language } = useLanguage();
  return (value: string | null, withTime = false) => (value
    ? new Date(value).toLocaleString(localeFor(language), withTime
      ? { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" }
      : { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
    : "");
}

function StatList({ snapshot, stats }: { snapshot: BuildSnapshot; stats: string[] }) {
  const { language } = useLanguage();
  return <>{stats.map((stat) => statName(snapshot, stat, language)).join(" + ")}</>;
}

/** Identical pets (same pet, same stats) shown once, with how many. */
function PetList({ snapshot, pets }: { snapshot: BuildSnapshot; pets: BuildPiece[] }) {
  const { language } = useLanguage();
  const groups = new Map<string, { pet: BuildPiece; count: number }>();
  for (const pet of pets) {
    const key = `${pieceKey(pet)}|${pet.stats.join("+")}`;
    const group = groups.get(key);
    if (group) group.count += 1;
    else groups.set(key, { pet, count: 1 });
  }
  return <ul className="builds-pets">
    {[...groups.values()].map(({ pet, count }, index) => <li key={index}>
      <b>{petName(snapshot, pet, language)}{count > 1 ? ` ×${count}` : ""}</b>
      {pet.stats.length > 0 && <span><StatList snapshot={snapshot} stats={pet.stats} /></span>}
    </li>)}
  </ul>;
}

function BuildBody({ snapshot, build, t }: { snapshot: BuildSnapshot; build: Build; t: Translate }) {
  const { language } = useLanguage();
  const facts = [
    build.weapon === "melee" ? t("Melee") : build.weapon === "ranged" ? t("Ranged") : "",
    build.fairy ? t("{name} fairy", { name: build.fairy }) : "",
    build.arenaWinRate !== null ? t("Wins {percent} of arena fights", { percent: `${Math.round(build.arenaWinRate * 100)}%` }) : "",
    build.quest ? t("Clears {stage}", { stage: build.quest }) : "",
  ].filter(Boolean);
  return <>
    {facts.length > 0 && <p className="builds-facts">{facts.map((fact) => <span key={fact}>{fact}</span>)}</p>}
    <dl className="builds-parts">
      <dt>{t("Skills")}</dt>
      <dd className="builds-skills">{build.skills.map((skill) => <span key={skill.id}>{skillName(snapshot, skill, language)}</span>)}</dd>
      {build.pets.length > 0 && <><dt>{t("Pets")}</dt><dd><PetList snapshot={snapshot} pets={build.pets} /></dd></>}
      {build.mount && <><dt>{t("Mount")}</dt><dd><b>{mountName(snapshot, build.mount, language)}</b>{build.mount.stats.length > 0 && <span> · <StatList snapshot={snapshot} stats={build.mount.stats} /></span>}</dd></>}
      {build.gear.length > 0 && <><dt>{t("Gear rows")}</dt><dd className="builds-gear">{build.gear.slice(0, 5).map((gear) => <span key={gear.stat}><b>({gear.rows})</b> {statName(snapshot, gear.stat, language)}</span>)}</dd></>}
    </dl>
  </>;
}

function GoalCard({ snapshot, goal, builds, t }: { snapshot: BuildSnapshot; goal: BuildGoal; builds: Build[]; t: Translate }) {
  const [more, setMore] = useState(false);
  const [best, ...others] = builds;
  if (!best) return null;
  return <section className={`panel builds-goal builds-goal-${goal}`}>
    <header>
      <h2><span aria-hidden="true">{GOALS[goal].emoji}</span> {t(GOALS[goal].label)}</h2>
      <p>{t(GOALS[goal].about)}</p>
    </header>
    <BuildBody snapshot={snapshot} build={best} t={t} />
    <a className="builds-source" href={BUILDS_PAGE_URL} target="_blank" rel="noreferrer" title={t("Its name on 1vcian’s site")}>
      {best.title} <ExternalLink size={12} aria-hidden="true" />
    </a>
    {others.length > 0 && <>
      <button type="button" className="builds-more" aria-expanded={more} onClick={() => setMore(!more)}>
        <ChevronDown size={14} aria-hidden="true" /> {more ? t("Hide the runners-up") : t("Show {count} runners-up", { count: others.length })}
      </button>
      {more && others.map((build, index) => <div key={build.key} className="builds-runner">
        <strong>{t("Runner-up {number}", { number: index + 2 })}</strong>
        <BuildBody snapshot={snapshot} build={build} t={t} />
        <a className="builds-source" href={BUILDS_PAGE_URL} target="_blank" rel="noreferrer">{build.title} <ExternalLink size={12} aria-hidden="true" /></a>
      </div>)}
    </>}
  </section>;
}

function MetaSummary({ page, snapshot, t }: { page: BuildsResponse; snapshot: BuildSnapshot; t: Translate }) {
  const { language } = useLanguage();
  const date = useDate();
  const meta = snapshot.meta;
  const changes = page.changes;
  const changeParts = changes ? [
    changes.skillsIn.length ? t("{names} in", { names: changes.skillsIn.map((names) => gameName(names, language)).join(", ") }) : "",
    changes.skillsOut.length ? t("{names} out", { names: changes.skillsOut.map((names) => gameName(names, language)).join(", ") }) : "",
    changes.pet ? t("top pet is now {name}", { name: gameName(changes.pet, language) }) : "",
    changes.arenaChanged ? t("new Arena winner") : "",
  ].filter(Boolean) : [];
  return <>
    <h3>{t("What the top builds have in common")}</h3>
    <dl className="builds-parts builds-meta">
      {meta.skills.length > 0 && <><dt>{t("Skills")}</dt><dd className="builds-skills">{meta.skills.map((skill) => <span key={skill.id}>{skillName(snapshot, skill, language)}</span>)}</dd></>}
      {meta.pet && <><dt>{t("Pets")}</dt><dd><b>{petName(snapshot, meta.pet, language)}</b>{meta.pet.stats.length > 0 && <span> · <StatList snapshot={snapshot} stats={meta.pet.stats} /></span>}</dd></>}
      {meta.mountStats.length > 0 && <><dt>{t("Mount")}</dt><dd><StatList snapshot={snapshot} stats={meta.mountStats} /></dd></>}
      {meta.gear.length > 0 && <><dt>{t("Gear rows")}</dt><dd>{meta.gear.map((stat) => statName(snapshot, stat, language)).join(" · ")}</dd></>}
    </dl>
    {changeParts.length > 0 && <p className="builds-changes">
      <b>{changes?.since ? t("Changed since {date}:", { date: date(changes.since) }) : t("Changed:")}</b> {changeParts.join(" · ")}
    </p>}
  </>;
}

function Links({ page, onChange, notify, t }: { page: BuildsResponse; onChange: (next: BuildsResponse) => void; notify: (message: string, error?: boolean) => void; t: Translate }) {
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ title: "", url: "", note: "" });
  async function add(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      onChange(await request<BuildsResponse>("/api/builds/links", { method: "POST", body: JSON.stringify({ title: form.title, url: form.url, ...(form.note.trim() ? { note: form.note } : {}) }) }));
      setForm({ title: "", url: "", note: "" });
      setAdding(false);
      notify(t("Link added."));
    } catch (error) { notify(t((error as Error).message), true); } finally { setBusy(false); }
  }
  async function remove(id: number) {
    setBusy(true);
    try {
      onChange(await request<BuildsResponse>("/api/builds/links", { method: "DELETE", body: JSON.stringify({ id }) }));
      notify(t("Link removed."));
    } catch (error) { notify(t((error as Error).message), true); } finally { setBusy(false); }
  }
  return <section className="panel builds-links">
    <h2>{t("More build guides")}</h2>
    <ul>
      <li><a href={DISCORD_BUILD_GUIDE_URL} target="_blank" rel="noreferrer">{t("Turmoil’s build guide")} <ExternalLink size={12} aria-hidden="true" /></a><span>{t("Which stats to aim for at each stage, in #🛡️-build-guide.")}</span></li>
      <li><a href={BUILDS_PAGE_URL} target="_blank" rel="noreferrer">{t("Every build on 1vcian’s site")} <ExternalLink size={12} aria-hidden="true" /></a><span>{t("The full list, with a fight simulator to compare builds.")}</span></li>
      {page.links.map((link) => <li key={link.id}>
        <a href={link.url} target="_blank" rel="noreferrer">{link.title} <ExternalLink size={12} aria-hidden="true" /></a>
        {link.note && <span>{link.note}</span>}
        {page.canEdit && <button type="button" className="icon-button builds-remove" disabled={busy} onClick={() => void remove(link.id)} aria-label={t("Remove {name}", { name: link.title })} title={t("Remove")}><Trash2 size={14} /></button>}
      </li>)}
    </ul>
    {page.canEdit && (adding
      ? <form className="builds-link-form" onSubmit={(event) => void add(event)}>
        <label>{t("Name")}<input value={form.title} maxLength={80} required onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder={t("e.g. Melee build video")} /></label>
        <label>{t("Link")}<input value={form.url} maxLength={300} required inputMode="url" onChange={(event) => setForm({ ...form, url: event.target.value })} placeholder="https://" /></label>
        <label>{t("Note (optional)")}<input value={form.note} maxLength={200} onChange={(event) => setForm({ ...form, note: event.target.value })} /></label>
        <span className="builds-link-actions">
          <button type="submit" className="button primary" disabled={busy}>{busy ? <LoaderCircle size={15} className="spin" /> : <Plus size={15} />} {t("Add link")}</button>
          <button type="button" className="button" disabled={busy} onClick={() => setAdding(false)}>{t("Cancel")}</button>
        </span>
      </form>
      : <button type="button" className="button builds-add" onClick={() => setAdding(true)}><Plus size={15} /> {t("Add a link")}</button>)}
  </section>;
}

function DiscordPreview({ message }: { message: { content: string; embeds: BuildsEmbed[] } }) {
  return <div className="builds-discord">
    {message.content && <p className="builds-discord-content">{message.content}</p>}
    {message.embeds.map((embed, index) => <div key={index} className="builds-embed" style={{ borderInlineStartColor: `#${embed.color.toString(16).padStart(6, "0")}` }}>
      <strong className="builds-embed-title">{embed.title}</strong>
      <p className="builds-embed-text"><DiscordText text={embed.description} /></p>
      {embed.footer && <small className="builds-embed-footer">{embed.footer}</small>}
    </div>)}
    <span className="builds-embed-buttons">
      <span className="builds-embed-button">Open the Builds page<ExternalLink size={13} aria-hidden="true" /></span>
      <span className="builds-embed-button">All builds on 1vcian<ExternalLink size={13} aria-hidden="true" /></span>
    </span>
  </div>;
}

/** Leaders: the builds thread in #🛡️-build-guide, its switch and what its next message looks like. */
function DiscordPanel({ page, onChange, notify, t }: { page: BuildsResponse; onChange: (next: BuildsResponse) => void; notify: (message: string, error?: boolean) => void; t: Translate }) {
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const discord = page.discord!;
  async function toggle() {
    setBusy(true);
    try {
      onChange(await request<BuildsResponse>("/api/builds", { method: "PUT", body: JSON.stringify({ discordEnabled: !discord.enabled }) }));
      notify(t(discord.enabled ? "Discord builds thread switched off." : "Discord builds thread switched on."));
    } catch (error) { notify(t((error as Error).message), true); } finally { setBusy(false); }
  }
  // Same server as the build guide channel.
  const threadUrl = discord.threadId ? DISCORD_BUILD_GUIDE_URL.replace(/\/\d+$/, `/${discord.threadId}`) : null;
  return <section className="panel builds-admin">
    <header>
      <div>
        <h2>{t("Discord builds thread")}</h2>
        <p>{t("A thread in #🛡️-build-guide. After each game update the new builds are posted at the bottom, and the old ones stay above, marked as old.")}</p>
      </div>
      <button type="button" className={`button ${discord.enabled ? "" : "primary"}`} disabled={busy} onClick={() => void toggle()}>
        {busy && <LoaderCircle size={15} className="spin" />} {discord.enabled ? t("Switch off") : t("Switch on")}
      </button>
    </header>
    <p className="builds-admin-state">
      {discord.enabled ? t("On. The thread updates by itself.") : t("Off. Nothing is posted in Discord.")}
      {threadUrl && <> · <a href={threadUrl} target="_blank" rel="noreferrer">{t("Open the thread")} <ExternalLink size={12} aria-hidden="true" /></a></>}
    </p>
    {discord.error && <p className="builds-error">{t("Discord: {error}", { error: discord.error })}</p>}
    {discord.preview && <>
      <button type="button" className="builds-more" aria-expanded={open} onClick={() => setOpen(!open)}>
        <ChevronDown size={14} aria-hidden="true" /> {open ? t("Hide the preview") : t("Preview the Discord message")}
      </button>
      {open && <DiscordPreview message={discord.preview} />}
    </>}
  </section>;
}

/** Builds (its own place in the side menu): the strongest builds right now, pulled every day from 1vcian's site. */
export function Builds({ notify }: { notify: (message: string, error?: boolean) => void }) {
  const { t } = useLanguage();
  const date = useDate();
  const [page, setPage] = useState<BuildsResponse | null>(null);
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const [old, setOld] = useState<BuildSnapshotResponse | null>(null);
  const [opening, setOpening] = useState<number | null>(null);
  const load = useCallback(async () => {
    try { setPage(await request<BuildsResponse>("/api/builds")); setError(""); } catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  async function checkNow() {
    setChecking(true);
    try {
      const next = await request<BuildsResponse>("/api/builds/refresh", { method: "POST" });
      setPage(next);
      notify(next.error ? t("Couldn’t check: {error}", { error: next.error }) : t("Builds checked."), !!next.error);
    } catch (e) { notify(t((e as Error).message), true); } finally { setChecking(false); }
  }
  async function openOld(id: number) {
    setOpening(id);
    try { setOld(await request<BuildSnapshotResponse>(`/api/builds/${id}`)); window.scrollTo({ top: 0, behavior: "smooth" }); }
    catch (e) { notify(t((e as Error).message), true); } finally { setOpening(null); }
  }
  if (!page) return <section className="panel war-empty">{error
    ? <><p>{t(error)}</p><button className="button primary" onClick={() => void load()}>{t("Try again")}</button></>
    : <LoaderCircle size={22} className="spin" />}</section>;
  const shown = old ?? page.current;
  const snapshot = shown?.data ?? null;
  const updated = page.current ? (page.current.data.gameDate ?? page.current.firstSeen) : null;
  return <div className="builds-page">
    <section className="panel builds-hero">
      <header>
        <div>
          <h2>{old ? t("Old builds") : t("Meta builds")}{snapshot?.gameDate ? ` · ${t("{date} game update", { date: date(snapshot.gameDate) })}` : ""}</h2>
          <p>{t("The best build for each goal, from 1vcian’s Forge Master fight simulator. Everything is at max level, so aim for these skills and stats as you grow.")}</p>
        </div>
        {page.canEdit && !old && <button type="button" className="button" disabled={checking} onClick={() => void checkNow()}>
          {checking ? <LoaderCircle size={15} className="spin" /> : <RefreshCw size={15} />} {t("Check now")}
        </button>}
      </header>
      {old && <p className="builds-old-note">
        {t("These builds were replaced on {date}.", { date: date(old.replacedAt) })}{" "}
        <button type="button" className="builds-link-button" onClick={() => setOld(null)}>{t("Back to the current builds")}</button>
      </p>}
      {snapshot ? <MetaSummary page={old ? { ...page, changes: null } : page} snapshot={snapshot} t={t} />
        : <p className="builds-empty">{t("No builds yet. The Hub checks 1vcian’s site every day.")}</p>}
      <p className="builds-checked">
        {page.checkedAt ? t("Checked daily · last checked {date}", { date: date(page.checkedAt, true) }) : t("Checked daily")}
        {updated && !old ? ` · ${t("builds from {date}", { date: date(updated) })}` : ""}
      </p>
      {page.error && <p className="builds-error">{t("Last check failed: {error}", { error: page.error })}</p>}
    </section>
    {snapshot && <div className="builds-goals">
      {snapshot.goals.map((entry) => <GoalCard key={`${shown!.id}-${entry.goal}`} snapshot={snapshot} goal={entry.goal} builds={entry.builds} t={t} />)}
    </div>}
    <Links page={page} onChange={setPage} notify={notify} t={t} />
    {page.archive.length > 0 && <section className="panel builds-archive">
      <h2><Archive size={16} aria-hidden="true" /> {t("Older builds")}</h2>
      <ul>
        {page.archive.map((entry) => <li key={entry.id}>
          <button type="button" className="builds-link-button" disabled={opening === entry.id} onClick={() => void openOld(entry.id)}>
            {entry.gameDate ? t("{date} game update", { date: date(entry.gameDate) }) : date(entry.firstSeen)}
          </button>
          <span>{entry.replacedAt ? t("replaced on {date}", { date: date(entry.replacedAt) }) : ""}</span>
        </li>)}
      </ul>
    </section>}
    {page.discord && <DiscordPanel page={page} onChange={setPage} notify={notify} t={t} />}
  </div>;
}
