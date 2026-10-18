"use client";

import Link from "next/link";
import { ClanBrand } from "./clan-brand";
import { BankHistory } from "./bank-history";
import { WarPlanner } from "./war-planner";
import { SnipePlanner } from "./snipe-planner";
import { DewStore } from "./dew-store";
import { HoardingWatch } from "./hoarding-watch";
import { RecognitionProvider, useRecognition } from "./recognition";
import { WarResults, WarTotalsHistory } from "./war-results";
import { SnipeChampions } from "./snipe-champions";
import { ContributionRanking } from "./contribution-ranking";
import { WarWeek } from "./war-week";
import { MemberHistoryPanel } from "./member-history";
import { ClanTech } from "./clan-tech";
import { MonthlyAwardsPanel } from "./monthly-awards";
import { LeadershipSettings } from "./leadership-settings";
import { downloadRows } from "@/lib/csv";
import { HomeArsenal, HomeMore, HomeWeek } from "./home-week";
import { ASCENSIONS_UPDATED, PILLAR_LABELS } from "@/lib/ascension";
import { useSortable } from "./sortable";
import { ClanPointsBalance } from "./clan-points-balance";
import { announceClanPointsUpdate } from "@/lib/clan-points";
import { MemberAvatar as Avatar, MemberName, MemberTitle } from "./member-identity";
import { DEFAULT_WAR_RATES, WAR_ACTIVITIES, estimateWar } from "@/lib/war";
import { assessBankCompleteness } from "@/lib/completeness";
import { filterPlanningIssues, memberPlanningIssues, type PlanningIssueKey } from "@/lib/planning-completeness";
import { MissingDataIndicator } from "./missing-data-indicator";
import { LanguagePicker } from "./language-picker";
import { FieldGuide, type GuidedField } from "./field-guide";
import { LanguageProvider, useT, type Translate } from "@/lib/i18n";
import missingDataStyles from "./missing-data-indicator.module.css";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  ArrowDownToLine,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Droplets,
  ArrowRight,
  ArrowUpRight,
  Backpack,
  Bell,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsUp,
  CircleHelp,
  CircleAlert,
  FlaskConical,
  Clipboard,
  Egg,
  Flame,
  History,
  Hammer,
  KeyRound,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  Menu,
  Search,
  ShieldCheck,
  Sparkles,
  Trophy,
  Crosshair,
  Swords,
  Ticket,
  Users,
  X,
} from "lucide-react";
import {
  EMPTY_RESOURCES,
  EMPTY_PLANNING_DETAILS,
  CHANCE_PLANNING_DETAILS,
  EMPTY_SUMMONING_COSTS,
  MOUNT_SUMMON_COST_MIN,
  MOUNT_SUMMON_COST_MAX,
  SKILL_SUMMON_COST_MIN,
  SKILL_SUMMON_COST_MAX,
  RESOURCE_FIELDS,
  currentWeek,
  formatWeek,
  numberFormat,
  resourceMaximum,
  skillCostHasValidPrecision,
  shiftWeek,
  type PlanningDetails,
  type ResourceKey,
  type ResourceValues,
  type SummoningCosts,
} from "@/lib/resources";
import type {
  AscensionPillar,
  AscensionsResponse,
  ClanSettings,
  DashboardResponse,
  EntryResponse,
  Member,
  MembersResponse,
  SessionResponse,
  WarEstimate,
  WarRates,
} from "@/lib/types";

type View = "dashboard" | "resources" | "members" | "weeks" | "war" | "warWeek" | "snipes" | "store" | "hoarding" | "warResults" | "vials" | "ranking" | "settings" | "tech";
const ADMIN_VIEWS: View[] = ["members", "hoarding", "ranking", "settings"];
type Icon = ComponentType<{
  size?: number;
  className?: string;
  strokeWidth?: number;
}>;
const viewNames = {
  dashboard: "Dashboard",
  resources: "My Resources",
  members: "Manage Members",
  weeks: "Weekly History",
  war: "Estimated War Points",
  warWeek: "War Week",
  snipes: "Snipe Plans",
  store: "Reward Shop",
  hoarding: "Hoarding Watch",
  warResults: "War Results",
  vials: "Vial Donations",
  ranking: "Contribution Ranking",
  settings: "Settings",
  tech: "Clan Tech",
};
const VIEW_HREF: Record<View, string> = {
  dashboard: "/",
  resources: "/resources",
  warWeek: "/war",
  snipes: "/snipes",
  war: "/war-points",
  warResults: "/war-results",
  vials: "/vial-donations",
  weeks: "/weeks",
  store: "/reward-shop",
  members: "/members",
  ranking: "/contribution-ranking",
  hoarding: "/hoarding-watch",
  settings: "/settings",
  tech: "/clan-tech",
};
type Section = "home" | "resources" | "war" | "records" | "store" | "leadership";
/** The menu: each section opens its first tab; sections with more than one page show tabs. */
const SECTIONS: { section: Section; label: string; short: string; icon: Icon; tabs: { view: View; label: string }[]; admin?: boolean }[] = [
  { section: "home", label: "Home", short: "Home", icon: LayoutDashboard, tabs: [{ view: "dashboard", label: "Home" }] },
  { section: "resources", label: "My Resources", short: "Resources", icon: Backpack, tabs: [{ view: "resources", label: "My Resources" }] },
  { section: "war", label: "War", short: "War", icon: Swords, tabs: [{ view: "warWeek", label: "This Week" }, { view: "snipes", label: "Snipes" }, { view: "war", label: "Points Calculator" }] },
  { section: "records", label: "Records", short: "Records", icon: Trophy, tabs: [{ view: "warResults", label: "War Results" }, { view: "vials", label: "Vials" }, { view: "tech", label: "Clan Tech" }, { view: "weeks", label: "Weekly History" }] },
  { section: "store", label: "Reward Shop", short: "Shop", icon: Droplets, tabs: [{ view: "store", label: "Reward Shop" }] },
  { section: "leadership", label: "Leadership", short: "Leadership", icon: ShieldCheck, admin: true, tabs: [{ view: "members", label: "Members" }, { view: "ranking", label: "Ranking" }, { view: "hoarding", label: "Hoarding" }, { view: "settings", label: "Settings" }] },
];
const sectionOf = (view: View) => SECTIONS.find((entry) => entry.tabs.some((tab) => tab.view === view))!;
/** Resources with war points on the dashboard (potions are tracked only). */
type GuidedResource = Exclude<ResourceKey, "potions">;
const essentials: {
  key: GuidedResource;
  icon: Icon;
  label: string;
  color: string;
}[] = [
  { key: "skillTickets", icon: Ticket, label: "Skill Tickets", color: "amber" },
  { key: "mountKeys", icon: KeyRound, label: "Mount Keys", color: "blue" },
  {
    key: "mountsToMerge",
    icon: Swords,
    label: "Mounts to Merge",
    color: "purple",
  },
  { key: "hammers", icon: Hammer, label: "Hammers", color: "orange" },
];
const dashboardResources = [
  ...essentials.slice(0, 2),
  { key: "eggsPetsTotal", icon: Egg, label: "Total eggs/pets", color: "gold" },
  ...essentials.slice(2),
] satisfies typeof essentials;
/** Potions came back to the form on this date; older saves never asked for them. */
const POTIONS_RETURNED = Date.parse("2026-10-18T02:30:00Z");
/** Short help under each box, and the caption for its picture of the game screen. */
const RESOURCE_GUIDE: Record<ResourceKey, { help: string; where: string }> = {
  skillTickets: { help: "Top left of the Skills screen.", where: "Skills screen → the green ticket number at the top left." },
  mountKeys: { help: "Top of the Mounts screen.", where: "Mounts screen → the key number at the top." },
  mountsToMerge: { help: "Open a mount’s Upgrade screen, select all, and use the “Selected” number.", where: "Tap a mount → Upgrade → select all spare mounts → use the “Selected” number." },
  hammers: { help: "The number on the anvil on the Forge screen.", where: "Forge screen → the hammer number on the anvil." },
  eggsPetsTotal: { help: "Open a pet’s Upgrade screen, select all, and use the “Selected” number.", where: "Tap a pet → Upgrade → select all spare eggs/pets → use the “Selected” number." },
  eggshellsTotal: { help: "Top left of the Pets screen.", where: "Pets screen → the eggshell number at the top left." },
  potions: { help: "Top left of the Tech Tree screen (the red potion).", where: "Tech Tree screen → the red potion number at the top left." },
};

const OFFLINE_MESSAGE = "Can’t reach the tracker. Check your internet connection and try again.";
async function api<T>(url: string, options?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...options,
      headers: { "Content-Type": "application/json", ...options?.headers },
      cache: "no-store",
    });
  } catch {
    // The browser's own network errors are English-only and unclear.
    throw new Error(OFFLINE_MESSAGE);
  }
  let data: { error?: string; code?: string };
  try {
    data = await response.json();
  } catch {
    data = { error: response.ok ? undefined : "Something went wrong. Please try again." };
  }
  if (!response.ok) {
    const error = new Error(data.error || "Something went wrong. Please try again.");
    Object.assign(error, { status: response.status, code: data.code });
    throw error;
  }
  return data as T;
}
function ago(date: string | null, t: Translate) {
  if (!date) return t("Not yet updated");
  const minutes = Math.max(
    0,
    Math.round((Date.now() - new Date(date).getTime()) / 60000),
  );
  if (minutes < 1) return t("Just now");
  if (minutes < 60) return t("{count}m ago", { count: minutes });
  if (minutes < 1440) return t("{count}h ago", { count: Math.floor(minutes / 60) });
  return t("{count}d ago", { count: Math.floor(minutes / 1440) });
}
function freshness(date: string | null) {
  if (!date) return { color: "stale", label: "Never updated" };
  const elapsed = Math.max(0, Date.now() - new Date(date).getTime());
  if (elapsed < 24 * 60 * 60 * 1000) return { color: "fresh", label: "Updated under 24 hours ago" };
  if (elapsed < 7 * 24 * 60 * 60 * 1000) return { color: "aging", label: "Updated 1–7 days ago" };
  return { color: "stale", label: "Updated a week ago or longer" };
}
function Freshness({ date }: { date: string | null }) {
  const t = useT();
  const status = freshness(date);
  return <span className={`freshness ${status.color}`} title={t(status.label)}><i aria-hidden="true" />{date ? ago(date, t) : t("Never updated")}</span>;
}
function validWeekFromQuery(value: string | null): string {
  if (
    !value ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    value < "2000-01-01" ||
    value > "2100-12-31"
  )
    return currentWeek();
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
    ? currentWeek(date)
    : currentWeek();
}
function DiscordIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M19.7 5.5A18 18 0 0 0 15.5 4l-.5 1a15 15 0 0 0-6 0l-.5-1a18 18 0 0 0-4.2 1.5C1.6 9.6.8 13.6 1.2 17.5a17 17 0 0 0 5.2 2.6l1-1.7-1.7-.8.4-.3c3.8 1.7 8 1.7 11.8 0l.4.3-1.7.8 1 1.7a17 17 0 0 0 5.2-2.6c.5-4.5-.9-8.5-3.1-12ZM8.3 14.9c-1 0-1.7-.9-1.7-2s.7-2 1.7-2 1.8.9 1.7 2-.7 2-1.7 2Zm7.4 0c-1 0-1.7-.9-1.7-2s.7-2 1.7-2 1.8.9 1.7 2-.7 2-1.7 2Z" />
    </svg>
  );
}

export default function Tracker({ view }: { view: View }) {
  return (
    <LanguageProvider>
      <TrackerApp view={view} />
    </LanguageProvider>
  );
}

function TrackerApp({ view }: { view: View }) {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const snapshotId = params.get("snapshot");
  const explicitWeek = params.get("week");
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [sessionError, setSessionError] = useState("");
  const [week, setWeek] = useState(currentWeek());
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [warRates, setWarRates] = useState(DEFAULT_WAR_RATES);
  const [loadedSnapshotId, setLoadedSnapshotId] = useState<string | null | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState<{
    message: string;
    error?: boolean;
  } | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notifications, setNotifications] = useState(false);
  const [help, setHelp] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestGeneration = useRef(0);
  const notify = useCallback((message: string, isError = false) => {
    setToast({ message, error: isError });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 4500);
  }, []);
  useEffect(() => {
    setWeek(validWeekFromQuery(params.get("week")));
  }, [params]);
  const checkSession = useCallback(async () => {
    try {
      const result = await api<SessionResponse>("/api/session");
      if (result.canonicalOrigin && window.location.origin !== result.canonicalOrigin) {
        // Opened from an old link: move to the public address so sign-in sticks.
        window.location.replace(`${result.canonicalOrigin}${window.location.pathname}${window.location.search}`);
        return;
      }
      setSessionError("");
      setSession(result);
      if (!result.user) {
        requestGeneration.current++;
        setData(null);
      }
    } catch (e) {
      const status = (e as Error & { status?: number }).status;
      if (status === 401 || status === 403) {
        requestGeneration.current++;
        setData(null);
        setSession((previous) => ({ configured: previous?.configured ?? true, demo: previous?.demo ?? false, user: null, error: "discord-auth-failed" }));
      } else {
        // Temporary service failures must not discard a valid device session.
        setSessionError((e as Error).message);
      }
    }
  }, []);
  useEffect(() => {
    void checkSession();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [checkSession]);
  const sessionUserId = session?.user?.id;
  const refresh = useCallback(async () => {
    if (!sessionUserId) return;
    // An unselected dashboard follows the live week across the Monday cutoff.
    // Explicit historical dates and snapshot links keep their selected period.
    const liveWeek = currentWeek();
    if (explicitWeek === null && snapshotId === null && week !== liveWeek) {
      requestGeneration.current++;
      setWeek(liveWeek);
      return;
    }
    const generation = ++requestGeneration.current;
    setLoading(true);
    setError("");
    try {
      const [bankResult, settingsResult] = await Promise.allSettled([
        api<DashboardResponse>(`/api/bank?week=${week}${snapshotId ? `&snapshot=${encodeURIComponent(snapshotId)}` : ""}`),
        api<{ settings: ClanSettings }>("/api/settings"),
      ]);
      if (bankResult.status === "rejected") throw bankResult.reason;
      if (generation === requestGeneration.current) {
        setData(bankResult.value);
        setLoadedSnapshotId(snapshotId);
        if (settingsResult.status === "fulfilled") setWarRates(settingsResult.value.settings.warRates);
      }
    } catch (e) {
      if (generation === requestGeneration.current) setError((e as Error).message);
      if ((e as Error & { status?: number }).status === 401) await checkSession();
    } finally {
      if (generation === requestGeneration.current) setLoading(false);
    }
  }, [sessionUserId, week, explicitWeek, snapshotId, checkSession]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    const renew = () => {
      if (document.visibilityState === "visible") {
        void checkSession();
        if (sessionUserId && ["dashboard", "war", "warWeek", "snipes"].includes(view)) void refresh();
      }
    };
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") void checkSession();
    }, 5 * 60 * 1000);
    window.addEventListener("focus", renew);
    document.addEventListener("visibilitychange", renew);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", renew);
      document.removeEventListener("visibilitychange", renew);
    };
  }, [sessionUserId, view, checkSession, refresh]);
  useEffect(() => {
    if (!["dashboard", "war", "warWeek", "snipes"].includes(view) || !sessionUserId) return;
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 30000);
    return () => clearInterval(interval);
  }, [view, sessionUserId, refresh]);
  function selectWeek(value: string) {
    const next = new URLSearchParams(params.toString());
    next.set("week", currentWeek(new Date(`${value}T00:00:00Z`)));
    next.delete("snapshot");
    router.push(`${pathname}?${next}`);
  }
  async function signOut() {
    try {
      await api("/api/auth/logout", { method: "POST" });
      window.location.href = "/";
    } catch (e) {
      notify((e as Error).message, true);
    }
  }
  function downloadCsv() {
    if (!data) return;
    // Clan totals first, then one row per member, so it opens straight in a spreadsheet.
    const names = new Map(data.members.map((member) => [member.id, member.username]));
    downloadRows(`turmoil-resources-${week}.csv`, [
      ["Member", ...RESOURCE_FIELDS.map(({ label }) => label), "Last updated"],
      ["CLAN TOTAL", ...RESOURCE_FIELDS.map(({ key }) => data.totals[key as ResourceKey] ?? 0), ""],
      ...data.entries
        .slice()
        .sort((a, b) => (names.get(a.memberId) ?? "").localeCompare(names.get(b.memberId) ?? ""))
        .map((entry) => [names.get(entry.memberId) ?? entry.updatedBy.username, ...RESOURCE_FIELDS.map(({ key }) => entry.resources[key as ResourceKey] ?? 0), entry.updatedAt]),
    ]);
    notify(t("Weekly totals exported as CSV."));
  }
  async function copyTotals() {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(
        `Turmoil · Week of ${week}\n${RESOURCE_FIELDS.map(({ key, label }) => `${label}: ${numberFormat(data.totals[key as ResourceKey])}`).join("\n")}`,
      );
      notify(t("Clan totals copied to your clipboard."));
    } catch {
      notify(t("Clipboard unavailable. Use Export CSV instead."), true);
    }
  }
  if (!session)
    return (
      <div className="initial-loading">
        <span className="brand-mark">
          <ClanBrand decorative />
        </span>
        {sessionError ? (
          <>
            <h2>{t("Couldn’t connect to the tracker")}</h2>
            <p>{t(sessionError)}</p>
            <button
              className="button primary"
              onClick={() => window.location.reload()}
            >
              {t("Try again")}
            </button>
          </>
        ) : (
          <>
            <LoaderCircle className="spin" size={22} />
            <p>{t("Loading…")}</p>
          </>
        )}
      </div>
    );
  if (!session.user)
    return (
      <Login
        configured={session.configured}
        error={session.error || params.get("error") || ""}
      />
    );
  const user =
    data?.currentUser.id === session.user.id
      ? data.currentUser
      : session.user;
  const denied = ADMIN_VIEWS.includes(view) && user.role !== "ADMIN";
  const dataMatches = !!data && data.week === week && loadedSnapshotId === snapshotId;
  // Home normally shows this week; a link from Weekly History opens an earlier week instead.
  const pastHome = snapshotId !== null || week !== currentWeek();
  let dashboardWar: ReturnType<typeof estimateWar> | null = null;
  let warEstimateError = "";
  if (data) {
    try { dashboardWar = estimateWar(data.entries, warRates, WAR_ACTIVITIES.map(({ key }) => key), data.live === false ? "historical" : "current"); }
    catch (e) { warEstimateError = (e as Error).message; }
  }
  /** The clan's totals and every member's numbers: folded away on Home, open when looking at a past week. */
  const renderClanTotals = (current: DashboardResponse) => <>
    <div className="section-heading">
      <div>
        <h2>
          {t(current.live === false ? "Saved weekly arsenal" : "The clan’s current arsenal")}{" "}
          <span className="live-badge">
            <i />
            {t(current.live === false ? "READ-ONLY HISTORY" : "LIVE TOTALS")}
          </span>
        </h2>
        <p>{t(current.live === false ? "Totals as they were saved that week." : "Everyone’s saved resources added together.")}</p>
      </div>
      {user.role === "ADMIN" && <div className="section-actions">
        <button className="button subtle" onClick={copyTotals}>
          <Clipboard size={15} />
          <span>{t("Copy totals")}</span>
        </button>
        <button className="button secondary" onClick={downloadCsv}>
          <ArrowDownToLine size={15} />
          {t("Export CSV")}
        </button>
      </div>}
    </div>
    {warEstimateError && <div className="error-banner" role="alert">{t("War estimate unavailable:")} {t(warEstimateError)}</div>}
    <ClanArsenal data={current} estimate={dashboardWar} rates={warRates} estimateError={warEstimateError} snapshotId={snapshotId} />
    <MemberResources data={current} week={week} admin={user.role === "ADMIN"} snapshotId={snapshotId} />
  </>;
  return (
    <RecognitionProvider enabled={!!sessionUserId}>
    <div className="app-shell">
      {mobileOpen && (
        <button
          className="sidebar-scrim"
          aria-label={t("Close navigation")}
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside className={`sidebar ${mobileOpen ? "open" : ""}`}>
        <Link className="brand" href="/">
          <span className="brand-mark">
            <ClanBrand decorative />
          </span>
          <span>
            <strong>TURMOIL</strong>
            <small>{t("CLAN HUB")}</small>
          </span>
        </Link>
        <span className="sidebar-label">{t("CLAN WORKSPACE")}</span>
        <nav aria-label={t("Main navigation")}>
          {SECTIONS
            .filter((entry) => !entry.admin || user.role === "ADMIN")
            .map(({ section, label, icon: NavIcon, tabs, admin }) => {
              const active = sectionOf(view).section === section;
              return (
                <Link
                  href={VIEW_HREF[tabs[0].view]}
                  key={section}
                  className={`nav-link ${active ? "active" : ""}`}
                  aria-current={active ? "page" : undefined}
                  onClick={() => setMobileOpen(false)}
                >
                  <NavIcon size={19} />
                  <span>{t(label)}</span>
                  {admin && (
                    <span className="nav-admin">
                      <ShieldCheck size={13} />
                    </span>
                  )}
                  {active && <span className="nav-active-dot" />}
                </Link>
              );
            })}
        </nav>
        <div className="sidebar-bottom">
          <div className="game-card">
            <Swords size={22} />
            <div>
              <strong>Forge Masters</strong>
            </div>
          </div>
          <button className="nav-link help-link" onClick={() => setHelp(true)}>
            <CircleHelp size={18} />
            {t("Tracker guide")}
            <ArrowUpRight size={14} />
          </button>
          <div className="sidebar-profile">
            <Avatar member={user} />
            <div>
              <strong><MemberName member={user} /></strong>
              <MemberTitle member={user} />
              <span>
                {user.role === "ADMIN" ? t("Clan admin") : t("Clan member")}
              </span>
            </div>
            <button
              className="icon-button"
              title={t("Sign out")}
              aria-label={t("Sign out")}
              onClick={signOut}
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              aria-label={t("Open navigation")}
              onClick={() => setMobileOpen(true)}
            >
              <Menu size={22} />
            </button>
            <span>Turmoil Clan Hub</span>
            <ChevronRight size={13} />
            <strong>{t(viewNames[view])}</strong>
          </div>
          <div className="topbar-actions">
            <LanguagePicker className="topbar-language" />
            <ClanPointsBalance memberId={user.id} revision={data?.currentUser.lastUpdatedAt} />
            {session.demo && <span className="demo-pill">{t("Demo workspace")}</span>}
            <span className="connection">
              <i />
              {t("Clan connected")}
            </span>
            <div className="notification-wrap">
              <button
                className={`icon-button ${notifications ? "selected" : ""}`}
                aria-label={t("Recent activity")}
                onClick={() => setNotifications(!notifications)}
              >
                <Bell size={19} />
                <span className="notification-dot" />
              </button>
              {notifications && (
                <div className="notification-panel">
                  <h3>{t("Recent clan activity")}</h3>
                  {data?.entries
                    .slice()
                    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
                    .slice(0, 4)
                    .map((entry) => (
                      <div key={entry.id}>
                        <CheckCircle2 size={17} />
                        <p>
                          <strong>{entry.updatedBy.username}</strong> {t("updated resources")}
                          <small>{ago(entry.updatedAt, t)}</small>
                        </p>
                      </div>
                    ))}
                  {!data?.entries.length && <p>{t("No resource bank updates yet.")}</p>}
                </div>
              )}
            </div>
            <Avatar member={user} small />
          </div>
        </header>
        <main className="main-content">
          {sectionOf(view).tabs.length > 1 && (!sectionOf(view).admin || user.role === "ADMIN") && (
            <nav className="section-tabs" aria-label={t(sectionOf(view).label)}>
              {sectionOf(view).tabs.map((tab) => (
                <Link key={tab.view} href={VIEW_HREF[tab.view]} className={tab.view === view ? "active" : ""} aria-current={tab.view === view ? "page" : undefined}>
                  {t(tab.label)}
                </Link>
              ))}
            </nav>
          )}
          <div className={`page-heading${view === "dashboard" && !pastHome ? " home-heading" : ""}`}>
            <div>
              <h1>
                {view !== "dashboard" ? t(viewNames[view]) : pastHome ? t("Resource Dashboard") : t("Hi, {name}", { name: user.username })}
              </h1>
              {(view !== "dashboard" || pastHome) && <p>
                {t(view === "dashboard"
                  ? "Saved weekly totals for the clan."
                  : view === "resources"
                    ? "Copy your numbers from the game, then press Save."
                    : view === "members"
                      ? "Manage who can use the tracker."
                      : view === "tech" ? "The clan’s tech tree and what we spend vials on next."
                      : view === "settings" ? "Clan Hub settings for leadership."
                      : view === "hoarding" ? "Spot members who hold a lot but don’t spend it. Only admins can see this page."
                      : view === "warResults" ? "Final clan war scores, read from the end-of-war screenshots."
                      : view === "vials" ? "Clan tech vial donations, read from the donation screenshots."
                      : view === "ranking" ? "Everyone ranked by how much they contribute. The bottom of the list is who to talk to first when space is needed."
                      : view === "war" ? "Pick activities to estimate the clan’s war points."
                      : view === "warWeek" ? "What scores on each war day, and how much the clan has saved for it."
                        : view === "snipes" ? "Plan events and say when you can join."
                          : view === "store" ? "Earn Clan Points by saving your resources each week, voting for clan days and joining snipes."
                            : "Saved weekly totals for the clan.")}
              </p>}
            </div>
            {(view === "weeks" || (view === "resources" && (user.role === "ADMIN" || week !== currentWeek())) || (view === "dashboard" && pastHome)) && (
              <div className="week-control">
                <button
                  className="icon-button"
                  aria-label={t("Previous week")}
                  onClick={() => selectWeek(shiftWeek(week, -1))}
                >
                  <ChevronLeft size={17} />
                </button>
                <label className="week-picker">
                  <CalendarDays size={16} />
                  <span>{t("Week of {date}", { date: formatWeek(week) })}</span>
                  <ChevronDown size={14} />
                  <input
                    aria-label={t("Select week")}
                    type="date"
                    value={week}
                    onChange={(e) =>
                      e.target.value && selectWeek(e.target.value)
                    }
                  />
                </label>
                <button
                  className="icon-button"
                  aria-label={t("Next week")}
                  onClick={() => selectWeek(shiftWeek(week, 1))}
                >
                  <ChevronRight size={17} />
                </button>
              </div>
            )}
          </div>
          {error && (
            <div className="error-banner" role="alert">
              <span>{t(error)}</span>
              <button onClick={refresh}>{t("Retry")}</button>
            </div>
          )}
          {denied ? (
            <section className="empty-state">
              <ShieldCheck size={32} />
              <h2>{t("Admin access required")}</h2>
              <p>{t("Only clan admins can manage the member roster.")}</p>
              <Link href="/" className="button primary">
                {t("Back to dashboard")}
              </Link>
            </section>
          ) : !dataMatches && loading ? (
            <DashboardSkeleton />
          ) : data && dataMatches && view === "dashboard" ? (
            data.live === false ? (
              <>
                <div className="home-history">
                  <span>{t("{count} of {total} members", { count: data.stats.submittedMembers, total: data.stats.totalMembers })} {t("had resources in this saved week")}</span>
                  <div className="section-actions">
                    <Link className="button subtle" href={`/resources?week=${week}${snapshotId ? `&snapshot=${encodeURIComponent(snapshotId)}` : ""}`}>{t("View saved resources")}</Link>
                    <Link className="button secondary" href="/">{t("Back to this week")}<ArrowRight size={15} /></Link>
                  </div>
                </div>
                {renderClanTotals(data)}
              </>
            ) : (
              <>
                <HomeWeek data={data} notify={notify} between={<HomeArsenal minimum={warEstimateError ? null : dashboardWar?.minimum ?? 0} maximum={warEstimateError ? null : dashboardWar?.maximum ?? 0} />} />
                <MonthlyAwardsPanel members={data.members} />
                <SnipeChampions members={data.members} />
                <HomeMore>{renderClanTotals(data)}</HomeMore>
              </>
            )
          ) : data && dataMatches && view === "resources" ? (
            <ResourceForm
              data={data}
              week={week}
              memberId={params.get("member")}
              snapshotId={snapshotId}
              notify={notify}
              refresh={refresh}
            />
          ) : data && view === "vials" ? (
            <WarResults kind="vials" members={data.members} admin={user.role === "ADMIN"} notify={notify} />
          ) : data && view === "ranking" ? (
            <ContributionRanking />
          ) : data && view === "warResults" ? (
            <WarResults members={data.members} admin={user.role === "ADMIN"} notify={notify} />
          ) : data && view === "tech" ? (
            <ClanTech notify={notify} />
          ) : data && view === "settings" ? (
            <LeadershipSettings />
          ) : data && view === "hoarding" ? (
            <HoardingWatch notify={notify} />
          ) : data && view === "members" ? (
            <MembersManager currentUser={user} notify={notify} refresh={refresh} />
          ) : data && dataMatches && view === "weeks" ? (
            <Weeks data={data} week={week} selectWeek={selectWeek} notify={notify} refresh={refresh} />
          ) : data && view === "warWeek" ? (
            <WarWeek data={data} admin={user.role === "ADMIN"} notify={notify} />
          ) : data && view === "war" ? (
            <WarPlanner data={data} notify={notify} refresh={refresh} />
          ) : data && view === "snipes" ? (
            <SnipePlanner data={data} notify={notify} refresh={refresh} />
          ) : data && view === "store" ? (
            <DewStore data={data} notify={notify} refresh={refresh} />
          ) : null}
          <footer className="page-footer">
            <span>
              <Flame size={13} />
              {t("THE TURMOIL WAY")}
            </span>
          </footer>
        </main>
      </div>
      <nav className="bottom-bar" aria-label={t("Quick navigation")}>
        {SECTIONS.filter((entry) => !entry.admin).map(({ section, short, icon: NavIcon, tabs }) => (
          <Link key={section} href={VIEW_HREF[tabs[0].view]} className={sectionOf(view).section === section ? "active" : ""} aria-current={sectionOf(view).section === section ? "page" : undefined}>
            <NavIcon size={20} />
            <span>{t(short)}</span>
          </Link>
        ))}
      </nav>
      {toast && (
        <div
          className={`toast ${toast.error ? "toast-error" : ""}`}
          role="status"
        >
          {toast.error ? <X size={18} /> : <CheckCircle2 size={18} />}
          {t(toast.message)}
          <button
            className="icon-button"
            aria-label={t("Dismiss notification")}
            onClick={() => setToast(null)}
          >
            <X size={15} />
          </button>
        </div>
      )}
      {help && (
        <div className="modal-backdrop" onClick={() => setHelp(false)}>
          <section
            className="guide-modal"
            role="dialog"
            aria-modal="true"
            aria-label={t("Tracker guide")}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="icon-button modal-close"
              aria-label={t("Close guide")}
              onClick={() => setHelp(false)}
            >
              <X size={20} />
            </button>
            <span className="brand-mark">
              <ClanBrand decorative />
            </span>
            <h2>{t("How the tracker works")}</h2>
            <p>{t("Open My Resources, copy each number from the game, and press Save. Your numbers stay saved until you change them.")}</p>
            <div className="guide-row">
              <Backpack size={20} />
              <div>
                <strong>{t("1. Fill in every box")}</strong>
                <p>{t("Not sure where a number is? Tap “Where do I find this?” under the box to see a picture of the game screen.")}</p>
              </div>
            </div>
            <div className="guide-row">
              <Check size={20} />
              <div>
                <strong>{t("2. Press Save each week")}</strong>
                <p>{t("Saving a complete form earns 20 Clan Points each week. You only need to change numbers that changed.")}</p>
              </div>
            </div>
            <div className="guide-row">
              <CalendarDays size={20} />
              <div>
                <strong>{t("3. Weekly totals")}</strong>
                <p>{t("Every Monday at 00:00 UTC the clan totals are saved. You can view past weeks, but not change them.")}</p>
              </div>
            </div>
            <Link className="button secondary guide-modal-link" href="/guide">
              {t("See the picture guide")}
              <ArrowRight size={16} />
            </Link>
            <button className="button primary" onClick={() => setHelp(false)}>
              {t("Got it")}
              <Check size={16} />
            </button>
          </section>
        </div>
      )}
    </div>
    </RecognitionProvider>
  );
}

function Login({ configured, error }: { configured: boolean; error: string }) {
  const t = useT();
  const messages: Record<string, string> = {
    "auth-cancelled":
      "Discord authorization was cancelled. You can try signing in again.",
    "invalid-state": "Your sign-in request expired. Please start again.",
    "guild-required":
      "You need to belong to the Turmoil Discord server to sign in.",
    "role-required":
      "Your Discord account needs the required Turmoil role to sign in.",
    "account-inactive":
      "Your tracker account has been deactivated. Contact a clan admin.",
    "discord-unavailable":
      "Discord is temporarily unavailable. Please try again shortly.",
    "discord-auth-failed":
      "Your Discord authorization expired. Please sign in again.",
    "sign-in-failed":
      "Discord sign-in could not be completed. Please try again.",
  };
  const message =
    messages[error] ||
    (error ? "Discord sign-in could not be completed. Please try again." : "");
  return (
    <main className="login-page">
      <div className="login-grid" />
      <div className="login-brand">
        <span className="brand-mark">
          <ClanBrand decorative />
        </span>
        <strong>TURMOIL</strong>
      </div>
      <LanguagePicker className="login-language" />
      <div className="login-stage">
        <div className="login-art">
          <ClanBrand
            variant="full"
            className="login-crest"
            size={480}
            sizes="(max-width: 650px) 195px, (max-width: 900px) 340px, 480px"
          />
          <span className="crest-caption">{t("THE TURMOIL WAY")}</span>
        </div>
        <section className="login-card">
          <h1>
            Turmoil
            <br />
            <span>Clan Hub</span>
          </h1>
          <p>{t("Sign in with Discord once. This device will remember you.")}</p>
          {message && (
            <div className="error-banner" role="alert">
              {t(message)}
            </div>
          )}
          <a
            className={`button discord-button ${!configured ? "disabled" : ""}`}
            href={configured ? "/api/auth/login" : undefined}
            aria-disabled={!configured}
          >
            <DiscordIcon />
            {t("Continue with Discord")}
            <ArrowRight size={17} />
          </a>
          <p className="login-device-note">{t("Opened this from Discord on your phone? Tap ⋯ and choose “Open in browser” so you stay signed in.")}</p>
          <div className="login-security">
            <ShieldCheck size={15} />
            {t("Only for members of the Turmoil clan")}
          </div>
          {!configured && (
            <p className="login-config">
              Discord login is awaiting configuration. Follow the repository setup
              guide to connect your Discord application.
            </p>
          )}
        </section>
      </div>
    </main>
  );
}

function WarPointRange({ minimum, maximum }: { minimum: number | null; maximum: number | null }) {
  const t = useT();
  return (
    <div className="war-point-range">
      <div><span>{t("Low estimate")}</span><strong>{minimum === null ? "--" : numberFormat(minimum)}</strong></div>
      <div><span>{t("High estimate")}</span><strong>{maximum === null ? "--" : numberFormat(maximum)}</strong></div>
    </div>
  );
}

function ClanArsenal({ data, estimate, rates, estimateError, snapshotId }: { data: DashboardResponse; estimate: WarEstimate | null; rates: WarRates; estimateError: string; snapshotId: string | null }) {
  const t = useT();
  const quantity = (activity: WarEstimate["rows"][number]["activity"]) => estimate?.rows.find((row) => row.activity === activity)?.quantity ?? 0;
  const points = (...activities: WarEstimate["rows"][number]["activity"][]) => estimate?.rows.filter((row) => activities.includes(row.activity)).reduce((total, row) => total + row.minimum, 0) ?? 0;
  const expected = (value: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(value);
  const live = data.live !== false;
  const chanceEntries = data.entries.filter((entry) => entry.planningDetails?.calculationVersion === 2 || entry.planningDetails?.extraMountChancePercent !== undefined || entry.planningDetails?.extraPetSummonPercent !== undefined).length;
  const chanceHistory = live || chanceEntries > 0;
  const mixedHistory = !live && chanceEntries > 0 && chanceEntries < data.entries.length;
  const incompleteMembers = memberPlanningIssues(data);
  const membersMissingCosts = filterPlanningIssues(incompleteMembers, ["fiveSkills", "mount"]);
  return (
    <>
      <article className="stat-card arsenal-summary arsenal-total">
        <div className="arsenal-summary-head">
          <div className="stat-label"><span className="resource-icon gold"><Sparkles size={19} /></span><span>{t("Total Potential War Points")}</span></div>
          <p className="arsenal-summary-copy">{t("The clan’s combined war estimate")}</p>
        </div>
        <WarPointRange minimum={estimateError ? null : estimate?.minimum ?? 0} maximum={estimateError ? null : estimate?.maximum ?? 0} />
        <div className="arsenal-summary-footer">
          <MissingDataIndicator members={incompleteMembers} label={t(membersMissingCosts.length > 0
            ? "Some summon costs are missing. This total is incomplete."
            : "Add missing extra chances to include all bonus points.")} />
          <Link className="arsenal-planner-link" href={`/war-points${data.live === false ? `?week=${data.week}${snapshotId ? `&snapshot=${encodeURIComponent(snapshotId)}` : ""}` : ""}`}>{t("View war calculator")} <ArrowRight size={14} /></Link>
        </div>
      </article>
    <p className="arsenal-swipe-hint">{t("Swipe to see all five")} <ArrowRight size={13} /></p>
    <div className="stat-grid arsenal-grid arsenal-row">
      {dashboardResources.map(({ key, label, icon: StatIcon, color }) => {
        const cardPoints = key === "skillTickets" ? points("skillSummons")
          : key === "mountKeys" ? points("mountSummons", "newMountMerges")
            : key === "eggsPetsTotal" ? points("eggMerges", "eggSummonMerges")
              : key === "mountsToMerge" ? points("mountMerges") : points("hammers");
        const cardIssues = filterPlanningIssues(incompleteMembers, key === "skillTickets" ? ["fiveSkills"] : key === "mountKeys" ? ["mount", "extraMountChancePercent"] : key === "eggsPetsTotal" ? ["extraPetSummonPercent"] : []);
        const missingCosts = filterPlanningIssues(cardIssues, ["fiveSkills", "mount"]).length;
        const missingChances = filterPlanningIssues(cardIssues, ["extraMountChancePercent", "extraPetSummonPercent"]).length;
        return (
          <article className={`stat-card arsenal-card arsenal-${key}`} key={key}>
            <div className="stat-label"><span className={`resource-icon ${color}`}><StatIcon size={19} strokeWidth={1.8} /></span><span>{t(label)}</span></div>
            <strong className="stat-number">{numberFormat(data.totals[key])}</strong>
            <div className="stat-war-points">
              <span className="war-points-label">{t("Potential clan war points")}</span>
              {key === "hammers" ? <WarPointRange minimum={estimateError ? null : cardPoints} maximum={estimateError ? null : estimate?.rows.find((row) => row.activity === "hammers")?.maximum ?? 0} /> : <strong className="war-points-total">{estimateError ? "--" : numberFormat(cardPoints)}</strong>}
            </div>
            <MissingDataIndicator members={cardIssues} label={missingCosts > 0
              ? `${t("Incomplete: {count} member(s) missing a summon cost.", { count: missingCosts })}${missingChances > 0 ? ` ${t("Extra chances are also missing.")}` : ""}`
              : t("{count} member(s) missing an extra chance, so bonus points are incomplete.", { count: missingChances })} />
            <details className="arsenal-more">
            <summary>{t("Details")}</summary>
            <div className="arsenal-details">
              {key === "skillTickets" && <div className="arsenal-metric"><span>{t("Total skill summons")}</span><strong>{estimateError ? "--" : numberFormat(quantity("skillSummons"))}</strong></div>}
              {key === "mountKeys" && <>
                <div className="arsenal-metric"><span>{t("Total mount summons")}</span><strong>{estimateError ? "--" : numberFormat(quantity("mountSummons"))}</strong></div>
                <div className="arsenal-metric"><span>{t(mixedHistory ? "Bonus / planned new merges" : chanceHistory ? "Expected bonus merges" : "Planned new merges")}</span><strong>{estimateError ? "--" : expected(quantity("newMountMerges"))}</strong></div>
              </>}
              {key === "eggsPetsTotal" && <>
                <div className="arsenal-metric"><span>{t("Eggshells total")}</span><strong>{numberFormat(data.totals.eggshellsTotal)}</strong></div>
                {!live && <div className="arsenal-metric"><span>{t("Saved existing merges")}</span><strong>{estimateError ? "--" : numberFormat(quantity("eggMerges"))}</strong></div>}
                <div className="arsenal-metric"><span>{t(mixedHistory ? "Extra / planned pet merges" : chanceHistory ? "Expected extra pet merges" : "Planned summon/merge actions")}</span><strong>{estimateError ? "--" : expected(quantity("eggSummonMerges"))}</strong></div>
              </>}
              {key === "mountsToMerge" && <p className="arsenal-note">{t("Mounts you already have. Bonus mounts are counted under Mount Keys.")}</p>}
              {key === "hammers" && <p className="arsenal-note">{t("{min}–{max} points per hammer.", { min: numberFormat(rates.hammersMin), max: numberFormat(rates.hammersMax) })}</p>}
              {(key === "skillTickets" || key === "mountKeys") && <p className="arsenal-note">{t("Whole summons, worked out for each member.")}{key === "mountKeys" && chanceHistory ? ` ${t("Bonus merges use each member’s extra mount chance.")}` : ""}</p>}
              {key === "eggsPetsTotal" && <p className="arsenal-note">{t(mixedHistory ? "Older entries keep their original counts; newer ones use totals and extra chances." : chanceHistory ? "All eggs/pets can be merged. Extra pets = eggshells ÷ 100 × each member’s extra chance." : "This week keeps its original saved merge counts.")}</p>}
              <p className="war-points-note">{key === "skillTickets" ? t("{points} points per skill summon.", { points: numberFormat(rates.skillSummons) })
                : key === "mountKeys" ? t("Summons {summon} + bonus merges {bonus} points each.", { summon: numberFormat(rates.mountSummons), bonus: numberFormat(rates.newMountMerges) })
                  : key === "eggsPetsTotal" ? t("Existing merges {existing} + extra pet merges {extra} points each.", { existing: numberFormat(rates.eggMerges), extra: numberFormat(rates.eggSummonMerges) })
                    : key === "mountsToMerge" ? t("{points} points per existing mount merge.", { points: numberFormat(rates.mountMerges) }) : t("Shows the lowest and highest hammer estimate.")}</p>
            </div>
            </details>
          </article>
        );
      })}
    </div>
    </>
  );
}

/** Which table column each missing detail belongs to, so only that box is marked. */
const CELL_ISSUES: Partial<Record<ResourceKey, PlanningIssueKey[]>> = {
  skillTickets: ["fiveSkills"],
  mountKeys: ["mount", "extraMountChancePercent"],
  eggshellsTotal: ["extraPetSummonPercent"],
};

/** Who is ascending in a clan week (memberId → what), for the member table. */
function useAscending(week: string): Map<string, AscensionPillar[]> {
  const [state, setState] = useState<{ week: string; members: Map<string, AscensionPillar[]> } | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = () => fetch(`/api/ascensions?week=${week}`, { cache: "no-store" })
      .then((response) => response.ok ? response.json() as Promise<AscensionsResponse> : Promise.reject())
      .then((result) => { if (!cancelled) setState({ week, members: new Map(result.ascending.map((item) => [item.memberId, item.pillars])) }); })
      .catch(() => { if (!cancelled) setState((current) => current?.week === week ? current : { week, members: new Map() }); });
    void load();
    // Your own answer on Home changes the list straight away.
    window.addEventListener(ASCENSIONS_UPDATED, load);
    return () => { cancelled = true; window.removeEventListener(ASCENSIONS_UPDATED, load); };
  }, [week]);
  return state?.week === week ? state.members : new Map();
}

function MemberResources({
  data,
  week,
  admin,
  snapshotId,
}: {
  data: DashboardResponse;
  week: string;
  admin: boolean;
  snapshotId: string | null;
}) {
  const t = useT();
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("all");
  const ascending = useAscending(week);
  type ContributionSort = "username" | "updatedAt" | "snipes" | "war" | ResourceKey;
  const { data: recognitionData } = useRecognition();
  const snipeCount = (memberId: string) => recognitionData?.snipes.recent[memberId] ?? 0;
  const warPoints = (memberId: string) => recognitionData?.latestWar?.points[memberId];
  const [sort, setSort] = useState<{ key: ContributionSort; direction: "asc" | "desc" }>({ key: "username", direction: "asc" });
  const entries = new Map(data.entries.map((entry) => [entry.memberId, entry]));
  const incompleteMembers = memberPlanningIssues(data);
  const incompleteByMember = new Map(incompleteMembers.map((member) => [member.memberId, member]));
  const changeSort = (key: ContributionSort) => setSort((old) => ({
    key,
    direction: old.key === key ? (old.direction === "asc" ? "desc" : "asc") : key === "username" ? "asc" : "desc",
  }));
  const sortOrder = (key: ContributionSort) => sort.key === key ? (sort.direction === "asc" ? "ascending" as const : "descending" as const) : "none" as const;
  const sortIcon = (key: ContributionSort) => sort.key === key
    ? sort.direction === "asc" ? <ArrowUp size={12} aria-hidden="true" /> : <ArrowDown size={12} aria-hidden="true" />
    : <ArrowUpDown size={12} aria-hidden="true" />;
  const members = data.members
    .filter((member) => member.username.toLowerCase().includes(search.toLowerCase()))
    .filter((member) => tab === "all" || (tab === "ascending" ? ascending.has(member.id) : tab === "submitted" ? entries.has(member.id) : !entries.has(member.id)))
    .sort((a, b) => {
      const value = (member: Member) => sort.key === "username" ? member.username : sort.key === "updatedAt"
        ? new Date(entries.get(member.id)?.updatedAt ?? 0).getTime()
        : sort.key === "snipes" ? snipeCount(member.id)
          : sort.key === "war" ? warPoints(member.id) ?? -1
            : entries.get(member.id)?.resources[sort.key] ?? 0;
      const av = value(a), bv = value(b);
      const comparison = typeof av === "string" && typeof bv === "string"
        ? av.localeCompare(bv, undefined, { sensitivity: "base", numeric: true }) : Number(av) - Number(bv);
      return comparison * (sort.direction === "asc" ? 1 : -1);
    });
  return (
    <section className="member-resources panel">
      <div className="table-section-heading">
        <div>
          <h2>
            {t("Member contributions")}{" "}
            <span className="count-badge">{data.stats.totalMembers}</span>
          </h2>
          <p>{t("What each member has saved.")}</p>
        </div>
        <label className="search-input">
          <Search size={16} />
          <input
            placeholder={t("Search members…")}
            aria-label={t("Search members…")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <kbd>⌕</kbd>
        </label>
      </div>
      <div className="table-tabs">
        <button
          className={tab === "all" ? "active" : ""}
          onClick={() => setTab("all")}
        >
          {t("All members")}<span>{data.stats.totalMembers}</span>
        </button>
        <button
          className={tab === "submitted" ? "active" : ""}
          onClick={() => setTab("submitted")}
        >
          {t("Updated")}<span>{data.stats.submittedMembers}</span>
        </button>
        <button
          className={tab === "pending" ? "active" : ""}
          onClick={() => setTab("pending")}
        >
          {t("Pending")}<span>{data.stats.pendingMembers}</span>
        </button>
        <button
          className={tab === "ascending" ? "active" : ""}
          onClick={() => setTab("ascending")}
        >
          <ChevronsUp size={13} aria-hidden="true" />{t("Ascending")}<span>{ascending.size}</span>
        </button>
        <span className="table-scroll-hint">
          {t("Scroll sideways to see all resources")}
          <ArrowRight size={13} />
        </span>
      </div>
      {incompleteMembers.length > 0 && <p className={missingDataStyles.legend}><CircleAlert size={13} aria-hidden="true" />{t("Amber boxes show numbers a member still needs to add.")}</p>}
      <div className="table-scroll">
        <table className="resource-table">
          <thead>
            <tr>
              <th className="sticky-member" aria-sort={sortOrder("username")}><button className="column-sort" onClick={() => changeSort("username")}>{t("Member")} {sortIcon("username")}</button></th>
              {RESOURCE_FIELDS.map(({ key, label }) => {
                const FieldIcon =
                  key === "eggsPetsTotal" || key === "eggshellsTotal"
                    ? Egg
                    : key === "potions" ? FlaskConical
                    : (essentials.find((field) => field.key === key)?.icon ??
                      Backpack);
                return (
                  <th key={key} aria-sort={sortOrder(key)}>
                    <button className="column-sort" onClick={() => changeSort(key)}>
                      <FieldIcon size={14} aria-hidden="true" />{t(label)}{sortIcon(key)}
                    </button>
                  </th>
                );
              })}
              <th aria-sort={sortOrder("snipes")}><button className="column-sort" onClick={() => changeSort("snipes")}><Crosshair size={14} aria-hidden="true" />{t("Snipes (8 wk)")}{sortIcon("snipes")}</button></th>
              <th aria-sort={sortOrder("war")}><button className="column-sort" onClick={() => changeSort("war")}><Trophy size={14} aria-hidden="true" />{t("Last war points")}{sortIcon("war")}</button></th>
              <th aria-sort={sortOrder("updatedAt")}><button className="column-sort" onClick={() => changeSort("updatedAt")}>{t("Last updated")} {sortIcon("updatedAt")}</button></th>
              <th>{t("Notes")}</th>
              {admin && <th>{t("Edit")}</th>}
            </tr>
          </thead>
          <tbody>
            {members.map((member) => {
              const entry = data.entries.find(
                (item) => item.memberId === member.id,
              );
              const resources = entry?.resources ?? EMPTY_RESOURCES;
              const missingInformation = incompleteByMember.get(member.id);
              return (
                <tr key={member.id} data-planning-incomplete={missingInformation ? "true" : undefined}>
                  <td className="sticky-member">
                    <div className="table-member">
                      <Avatar member={member} small />
                      <div>
                        <strong>
                          <MemberName member={member} />
                          {member.id === data.currentUser.id && (
                            <span className="you-badge">{t("you")}</span>
                          )}
                        </strong>
                        <MemberTitle member={member} />
                        <span>
                          <i
                            className={entry ? "updated-dot" : "pending-dot"}
                          />
                          {t(entry ? "Resources saved" : member.neverSignedIn ? "Never signed in" : "Not saved yet")}
                        </span>
                        {ascending.has(member.id) && <small className="row-ascending"><ChevronsUp size={12} aria-hidden="true" />{t("Ascending: {what}", { what: ascending.get(member.id)!.map((pillar) => t(PILLAR_LABELS[pillar])).join(", ") })}</small>}
                        {missingInformation && <small className="row-missing"><CircleAlert size={12} aria-hidden="true" />{t("Missing:")} {missingInformation.issues.map((issue) => t(issue.label)).join(", ")}</small>}
                      </div>
                    </div>
                  </td>
                  {RESOURCE_FIELDS.map(({ key }) => {
                    const cellIssues = missingInformation?.issues.filter((issue) => CELL_ISSUES[key as ResourceKey]?.includes(issue.key)) ?? [];
                    const missingText = cellIssues.map((issue) => t(issue.label)).join(", ");
                    return (
                      <td
                        key={key}
                        className={[key === "eggsPetsTotal" ? "accent-number" : "", cellIssues.length ? "cell-missing" : ""].filter(Boolean).join(" ") || undefined}
                        title={cellIssues.length ? t("Missing: {fields}", { fields: missingText }) : undefined}
                      >
                        {cellIssues.length > 0 && <CircleAlert size={12} className="cell-missing-icon" aria-label={t("Missing: {fields}", { fields: missingText })} />}
                        {numberFormat(resources[key as ResourceKey])}
                      </td>
                    );
                  })}
                  <td className={snipeCount(member.id) ? "snipe-cell" : undefined}>{snipeCount(member.id) || "—"}</td>
                  <td className="war-cell">{warPoints(member.id) === undefined ? "—" : numberFormat(warPoints(member.id)!)}</td>
                  <td
                    className="updated-cell"
                    title={
                      entry ? new Date(entry.updatedAt).toLocaleString() : ""
                    }
                  >
                    {entry ? (
                      <>
                        <Freshness date={entry.updatedAt} />
                        <small>{t("by {name}", { name: entry.updatedBy.username })}</small>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="notes-cell">{entry?.notes || "—"}</td>
                  {admin && (
                    <td>
                      <Link
                        className="text-link"
                        href={`/resources?week=${week}&member=${member.id}${snapshotId ? `&snapshot=${encodeURIComponent(snapshotId)}` : ""}`}
                      >
                        {t(data.live === false ? "View" : "Edit")}
                        <ArrowUpRight size={13} />
                      </Link>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        {!members.length && (
          <div className="table-empty">
            <Search size={22} />
            <p>{t("No members match this view.")}</p>
            <button
              className="text-link"
              onClick={() => {
                setSearch("");
                setTab("all");
              }}
            >
              {t("Clear filters")}
            </button>
          </div>
        )}
      </div>
      <div className="table-footer">
        <span>
          {t("Showing {count} of {total} members", { count: members.length, total: data.members.length })}
        </span>
        <span>
          <i />
          {t("Totals include active members only")}
        </span>
      </div>
    </section>
  );
}

interface EntryBox {
  /** Accessible name of the box (also used by the picture guide). */
  label: string;
  /** Small caption shown above the box when a line has two boxes. */
  caption?: string;
  decimal?: boolean;
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
  suffix?: string;
}

/** Keeps only digits (and one decimal point where allowed), so letters and commas can't be typed. */
function digitsOnly(value: string, decimal: boolean): string {
  const cleaned = value.replace(decimal ? /[^0-9.]/g : /[^0-9]/g, "");
  if (!decimal) return cleaned;
  const [whole, ...rest] = cleaned.split(".");
  return rest.length ? `${whole}.${rest.join("")}` : whole;
}

/** One line of the resource form: what to enter on the left, small boxes on the right. */
function EntryRow({ id, label, icon, badge, help, guide, boxes }: {
  id: string;
  label: string;
  icon?: ReactNode;
  /** A short tag after the label, e.g. "New". */
  badge?: string;
  help: string;
  guide?: ReactNode;
  boxes: EntryBox[];
}) {
  return (
    <div className={`entry-row${boxes.length > 1 ? " entry-row-pair" : ""}`}>
      <div className="entry-row-text">
        <label htmlFor={`field-${id}-0`}>{icon}{label}{badge && <span className="entry-row-badge">{badge}</span>}</label>
        <small className="field-help" id={`help-${id}`}>{help}</small>
      </div>
      <div className="entry-row-boxes">
        {boxes.map((box, index) => (
          <div className="entry-row-box" key={box.label}>
            {box.caption && <span className="entry-row-caption" aria-hidden="true">{box.caption}</span>}
            <div className="entry-row-field">
              <input
                id={`field-${id}-${index}`}
                aria-label={box.label}
                aria-describedby={`help-${id}`}
                type="text"
                inputMode={box.decimal ? "decimal" : "numeric"}
                autoComplete="off"
                required
                placeholder={box.placeholder}
                value={box.value}
                onChange={(event) => box.onChange(digitsOnly(event.target.value, !!box.decimal))}
              />
              {box.suffix && <span className="entry-row-suffix" aria-hidden="true">{box.suffix}</span>}
            </div>
          </div>
        ))}
      </div>
      {guide ? <div className="entry-row-guide">{guide}</div> : null}
    </div>
  );
}

function ResourceForm({
  data,
  week,
  memberId,
  snapshotId,
  notify,
  refresh,
}: {
  data: DashboardResponse;
  week: string;
  memberId: string | null;
  snapshotId: string | null;
  notify: (message: string, error?: boolean) => void;
  refresh: () => Promise<void>;
}) {
  const t = useT();
  const router = useRouter();
  const selected =
    data.currentUser.role === "ADMIN" && memberId
      ? (data.members.find((member) => member.id === memberId) ??
        data.currentUser)
      : data.currentUser;
  const entry = data.entries.find((item) => item.memberId === selected.id);
  const savedResources = entry?.resources ?? EMPTY_RESOURCES;
  const savedCosts = entry?.summoningCosts ?? EMPTY_SUMMONING_COSTS;
  const savedPlanning = entry?.planningDetails ?? EMPTY_PLANNING_DETAILS;
  const readOnly = data.live === false;
  const legacyHistory = readOnly && savedPlanning.calculationVersion !== 2 && savedPlanning.extraMountChancePercent === undefined && savedPlanning.extraPetSummonPercent === undefined;
  type PlanningFieldKey = Exclude<keyof PlanningDetails, "calculationVersion">;
  const isChance = (key: PlanningFieldKey) => key === "extraMountChancePercent" || key === "extraPetSummonPercent";
  const planningMaximum = (key: PlanningFieldKey) => isChance(key) ? 1000 : key.endsWith("Level") ? 1_000_000_000 : 1_000_000;
  const planningFields: { key: PlanningFieldKey; label: string; help: string; picture?: GuidedField; where?: string }[] = [
    { key: "skillLevel", label: "Skill level", help: "Tap ⓘ next to the Summon button on the Skills screen.", picture: "skillLevel", where: "Skills screen → tap ⓘ next to Summon. Use the Level number at the top." },
    { key: "mountLevel", label: "Mount level", help: "Tap ⓘ next to the Summon button on the Mounts screen.", picture: "mountLevel", where: "Mounts screen → tap ⓘ next to Summon. Use the Level number at the top." },
    { key: "eggLevel", label: "Egg/pet level", help: legacyHistory ? "Saved for reference alongside the original planned actions." : "Tap ⓘ next to the Summon button on the Pets screen.", picture: legacyHistory ? undefined : "eggLevel", where: "Pets screen → tap ⓘ next to Summon. Use the Level number at the top." },
    ...(legacyHistory ? [
      { key: "newMountMerges" as const, label: "Newly summoned mount merges", help: "Original planned merge count saved in this snapshot." },
      { key: "eggMerges" as const, label: "Existing egg/pet merges", help: "Original existing merge count saved in this snapshot." },
      { key: "eggSummonMerges" as const, label: "Egg/pet summon then merge", help: "Original future summon/merge count saved in this snapshot." },
    ] : [
      { key: "extraMountChancePercent" as const, label: "Extra mount chance %", help: "Enter the number only, e.g. 42. Enter 0 if you have none.", picture: "extraMountChancePercent" as const, where: "Tech Tree → tap ⓘ to open Total Bonuses → “Chance to summon an extra mount”." },
      { key: "extraPetSummonPercent" as const, label: "Extra pet summon %", help: "Enter the number only, e.g. 50. Enter 0 if you have none.", picture: "extraPetSummonPercent" as const, where: "Tech Tree → tap ⓘ to open Total Bonuses → “Chance to summon an extra egg”." },
    ]),
  ];
  const planningText = (details: PlanningDetails, key: PlanningFieldKey) => details[key] === undefined || (!entry && !readOnly && key.endsWith("Level")) ? "" : String(details[key]);
  const draftPlanning = (details: PlanningDetails) => Object.fromEntries(planningFields.map(({ key }) => [key, planningText(details, key)])) as Record<PlanningFieldKey, string>;
  const [planningValues, setPlanningValues] = useState(() => draftPlanning(savedPlanning));
  const resourceKeys = RESOURCE_FIELDS.map(({ key }) => key as ResourceKey);
  const potionsNeverAsked = !!entry && !readOnly && entry.resources.potions === 0 && Date.parse(entry.updatedAt) < POTIONS_RETURNED;
  const draftResources = (resources: ResourceValues) =>
    Object.fromEntries(
      resourceKeys.map((key) => [key, key === "potions" && potionsNeverAsked ? "" : String(resources[key])]),
    ) as Record<ResourceKey, string>;
  const [values, setValues] = useState<Record<ResourceKey, string>>(() =>
    draftResources(savedResources),
  );
  const [costValues, setCostValues] = useState<
    Record<keyof SummoningCosts, string>
  >(() => ({
    fiveSkills: String(savedCosts.fiveSkills),
    mount: String(savedCosts.mount),
  }));
  const [notes, setNotes] = useState(entry?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const savedDraft = draftResources(savedResources);
  const dirty =
    resourceKeys.some((key) => values[key] !== savedDraft[key]) ||
    costValues.fiveSkills !== String(savedCosts.fiveSkills) ||
    costValues.mount !== String(savedCosts.mount) ||
    planningFields.some(({ key }) => planningValues[key] !== planningText(savedPlanning, key)) ||
    notes !== (entry?.notes ?? "");
  useEffect(() => {
    setValues(draftResources(entry?.resources ?? EMPTY_RESOURCES));
    const costs = entry?.summoningCosts ?? EMPTY_SUMMONING_COSTS;
    setCostValues({
      fiveSkills: String(costs.fiveSkills),
      mount: String(costs.mount),
    });
    setPlanningValues(draftPlanning(entry?.planningDetails ?? EMPTY_PLANNING_DETAILS));
    setNotes(entry?.notes ?? "");
    setFormError("");
  }, [selected.id, week, entry]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty && !readOnly) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, readOnly]);
  const enteredNumber = (value: string | undefined) => !value?.trim() ? Number.NaN : Number(value);
  const draftBank = {
    resources: Object.fromEntries(resourceKeys.map((key) => [key, enteredNumber(values[key])])) as ResourceValues,
    summoningCosts: { fiveSkills: enteredNumber(costValues.fiveSkills), mount: enteredNumber(costValues.mount) },
    planningDetails: { ...CHANCE_PLANNING_DETAILS, ...savedPlanning, ...Object.fromEntries(planningFields.map(({ key }) => [key, enteredNumber(planningValues[key])])), calculationVersion: 2 as const },
  };
  const completeness = assessBankCompleteness(draftBank);
  // Levels and extra chances rarely change: once saved, show them in a short summary.
  const [showLevels, setShowLevels] = useState(false);
  const levelsSaved = !legacyHistory && !!entry && planningFields.every(({ key }) => planningText(savedPlanning, key) !== "");
  const levelsFolded = !readOnly && levelsSaved && !showLevels && !planningFields.some(({ label }) => completeness.missing.includes(label));
  const [noteOpen] = useState(() => !!entry?.notes);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (readOnly) return;
    if (!completeness.complete) {
      setFormError(t("Some boxes are still empty or wrong: {fields}.", { fields: completeness.missing.map((field) => t(field)).join(", ") }));
      return;
    }
    const planningDetails = draftBank.planningDetails;
    const resources = draftBank.resources;
    if (
      costValues.fiveSkills.trim() === "" ||
      costValues.mount.trim() === ""
    ) {
      setFormError(t("Enter both summon costs."));
      return;
    }
    const summoningCosts: SummoningCosts = {
      fiveSkills: Number(costValues.fiveSkills),
      mount: Number(costValues.mount),
    };
    const invalidResource = RESOURCE_FIELDS.find(({ key }) => {
      const value = resources[key as ResourceKey];
      return (
        !Number.isInteger(value) ||
        value < 0 ||
        value > resourceMaximum(key as ResourceKey)
      );
    });
    if (invalidResource) {
      setFormError(
        t("{field}: enter a whole number from 0 to {max}, with no commas or letters.", { field: t(invalidResource.label), max: numberFormat(resourceMaximum(invalidResource.key as ResourceKey)) }),
      );
      return;
    }
    if (
      !Number.isFinite(summoningCosts.fiveSkills) ||
      summoningCosts.fiveSkills < SKILL_SUMMON_COST_MIN ||
      summoningCosts.fiveSkills > SKILL_SUMMON_COST_MAX ||
      !skillCostHasValidPrecision(summoningCosts.fiveSkills)
    ) {
      setFormError(
        t("Skill summon cost (×5) must be between 150 and 200, for example 150."),
      );
      return;
    }
    if (
      !Number.isFinite(summoningCosts.mount) ||
      summoningCosts.mount < MOUNT_SUMMON_COST_MIN ||
      summoningCosts.mount > MOUNT_SUMMON_COST_MAX
    ) {
      setFormError(t("Mount summon cost must be between 37.5 and 50, for example 40."));
      return;
    }
    setSaving(true);
    setFormError("");
    try {
      await api<EntryResponse>("/api/bank", {
        method: "PUT",
        body: JSON.stringify({
          memberId: selected.id,
          resources,
          summoningCosts,
          planningDetails,
          notes,
        }),
      });
      announceClanPointsUpdate(selected.id);
      await refresh();
      notify(
        selected.id === data.currentUser.id
          ? t("Saved! Thank you. Clan totals are updated.")
          : t("{name}’s resources are saved.", { name: selected.username }),
      );
    } catch (e) {
      setFormError(t((e as Error).message));
    } finally {
      setSaving(false);
    }
  }
  const update = (key: ResourceKey, value: string) =>
    setValues((existing) => ({
      ...existing,
      [key]: value,
    }));
  return (
    <form className="resource-form" onSubmit={save} noValidate>
      {data.currentUser.role === "ADMIN" && <div className="entry-profile panel">
        <Avatar member={selected} />
        <div>
          <strong>
            <MemberName member={selected} />
            <span className="role-badge">
              {selected.role === "ADMIN" ? t("Admin") : t("Member")}
            </span>
          </strong>
          <MemberTitle member={selected} />
          <p>
            {entry
              ? t("Last saved {time} by {name}", { time: ago(entry.updatedAt, t), name: entry.updatedBy.username })
              : t("Nothing saved yet.")}
          </p>
        </div>
        {data.currentUser.role === "ADMIN" && (
          <label className="member-select">
            <span>{readOnly ? t("Viewing member") : t("Editing member")}</span>
            <select
              aria-label={t("Editing member")}
              value={selected.id}
              onChange={(e) => {
                if (
                  dirty &&
                  !window.confirm(
                    t("You have unsaved changes. Switch members without saving?"),
                  )
                )
                  return;
                router.push(`/resources?week=${week}&member=${e.target.value}${snapshotId ? `&snapshot=${encodeURIComponent(snapshotId)}` : ""}`);
              }}
            >
              {data.members.map((member) => (
                <option value={member.id} key={member.id}>
                  {member.username}
                  {member.id === data.currentUser.id ? ` (${t("you")})` : ""}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>}
      {readOnly && <div className="entry-notice">
        <ShieldCheck size={17} />
        <span>{t("These are the numbers saved for the week of {date}. They can’t be changed.", { date: formatWeek(week) })}</span>
      </div>}
      <div className="section-heading">
        <div>
          <h2>{readOnly ? t("Saved inventory") : t("Your current inventory")}</h2>
          <p>{t("Copy each number from the game. Not sure where it is? Tap “Where do I find this?”")}</p>
          {!readOnly && <p className="entry-saved-line">
            <ShieldCheck size={13} />
            <span>
              {data.currentUser.role !== "ADMIN" && <>{entry ? t("Last saved {time} by {name}", { time: ago(entry.updatedAt, t), name: entry.updatedBy.username }) : t("Nothing saved yet.")} · </>}
              {t("Your numbers are shared with the clan and stay saved until you change them.")}
            </span>
          </p>}
        </div>
        {readOnly && <Link className="button primary" href={`/resources${selected.id !== data.currentUser.id ? `?member=${selected.id}` : ""}`}>{t("Back to this week")} <ArrowRight size={15} /></Link>}
      </div>
      {!readOnly && <div className={`bank-completeness ${completeness.complete ? "complete" : "incomplete"}`} role="status">
        <ShieldCheck size={17} />
        <div><strong>{completeness.complete ? t("Every box is filled in") : t("Fill in every box to save")}</strong>
          <p>{t("A complete save earns 20 Clan Points this week. Enter 0 if you have none.")}</p>
          {!completeness.complete && <p className="bank-missing-fields">{t("Still to fill in:")} {completeness.missing.map((field) => t(field)).join(", ")}</p>}
          {selected.id !== data.currentUser.id && <p>{t("Editing another member does not earn you Clan Points.")}</p>}
        </div>
      </div>}
      {formError && (
        <div className="error-banner" role="alert">
          {formError}
        </div>
      )}
      <fieldset className="bank-fields" disabled={readOnly || saving}>
      <section className="panel form-section">
        <h3>
          <Backpack size={19} />
          {t("Main resources")}
        </h3>
        <div className="entry-list">
          {essentials.map(({ key, label, icon: InputIcon }) => {
            const guide = RESOURCE_GUIDE[key];
            const cost = key === "skillTickets"
              ? { key: "fiveSkills" as const, label: "Skill summon cost (×5)", caption: "Cost ×5", help: "On the blue Summon ×5 button. Between 150 and 200.", where: "Skills screen → the number on the blue “Summon x5” button." }
              : key === "mountKeys"
                ? { key: "mount" as const, label: "Mount summon cost (×1)", caption: "Cost ×1", help: "On the blue Summon ×1 button. Between 37.5 and 50.", where: "Mounts screen → the number on the blue “Summon x1” button." }
                : null;
            const boxes: EntryBox[] = [{ label: t(label), caption: cost ? t("Amount") : undefined, placeholder: "0", value: values[key], onChange: (value) => update(key, value) }];
            if (cost) boxes.push({ label: t(cost.label), caption: t(cost.caption), decimal: true, value: costValues[cost.key], onChange: (value) => setCostValues((existing) => ({ ...existing, [cost.key]: value })) });
            return (
              <EntryRow
                key={key}
                id={`resource-${key}`}
                label={t(label)}
                icon={<InputIcon size={15} />}
                help={cost ? `${t(guide.help)} ${t(cost.help)}` : t(guide.help)}
                guide={!readOnly && <>
                  <FieldGuide field={key} hint={t(guide.where)} label={cost ? t("Where’s the amount?") : undefined} />
                  {cost && <FieldGuide field={cost.key} hint={t(cost.where)} label={t("Where’s the cost?")} />}
                </>}
                boxes={boxes}
              />
            );
          })}
          <EntryRow
            id="resource-potions"
            label={t("Potions")}
            icon={<FlaskConical size={15} />}
            badge={potionsNeverAsked ? t("New") : undefined}
            help={t(RESOURCE_GUIDE.potions.help)}
            guide={!readOnly && <FieldGuide field="potions" hint={t(RESOURCE_GUIDE.potions.where)} />}
            boxes={[{ label: t("Potions"), placeholder: "0", value: values.potions, onChange: (value) => update("potions", value) }]}
          />
        </div>
      </section>
      <section className="panel form-section">
        <h3>
          <Egg size={19} />{t("Eggs and pets")}
        </h3>
        <div className="entry-list">
          {(["eggsPetsTotal", "eggshellsTotal"] as const).map((key) => (
            <EntryRow
              key={key}
              id={`resource-${key}`}
              label={t(key === "eggsPetsTotal" ? "Total eggs/pets" : "Eggshells total")}
              help={t(RESOURCE_GUIDE[key].help)}
              guide={!readOnly && <FieldGuide field={key} hint={t(RESOURCE_GUIDE[key].where)} />}
              boxes={[{ label: t(key === "eggsPetsTotal" ? "Total eggs/pets" : "Eggshells total"), placeholder: "0", value: values[key], onChange: (value) => update(key, value) }]}
            />
          ))}
        </div>
      </section>
      <section className="panel form-section">
        <div className="form-section-head">
          <h3><Swords size={19} />{legacyHistory ? t("Saved levels and planned actions") : t("Levels and extra chances")}</h3>
          {levelsFolded && <button type="button" className="button subtle small-button" onClick={() => setShowLevels(true)}>{t("Change")}</button>}
        </div>
        {levelsFolded ? <dl className="levels-summary">
          {planningFields.map(({ key, label }) => <div key={key}><dt>{t(label)}</dt><dd>{planningValues[key]}{isChance(key) ? "%" : ""}</dd></div>)}
        </dl> : <>
          <p className="form-section-subtitle">{legacyHistory ? t("This week keeps its original saved counts.") : t("Copy these from the game. The tracker does the maths for you.")}</p>
          <div className="entry-list">
            {planningFields.map(({ key, label, help, picture, where }) => (
              <EntryRow
                key={key}
                id={`planning-${key}`}
                label={t(label)}
                help={t(help)}
                guide={!readOnly && picture && where && <FieldGuide field={picture} hint={t(where)} />}
                boxes={[{ label: t(label), decimal: isChance(key), placeholder: isChance(key) ? t("Enter 0 if none") : t("e.g. 100"), value: planningValues[key], onChange: (value) => setPlanningValues((old) => ({ ...old, [key]: value })), suffix: isChance(key) ? "%" : undefined }]}
              />
            ))}
          </div>
        </>}
      </section>
      <details className="panel form-section form-note" open={noteOpen}>
        <summary>
          <Clipboard size={19} />{t("A note for the clan")}{" "}
          <span className="optional-badge">{t("OPTIONAL")}</span>
          <ChevronDown size={16} className="form-note-chevron" />
        </summary>
        <textarea
          aria-label={t("Notes")}
          maxLength={1000}
          placeholder={t("Anything the clan should know? (optional)")}
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
        <div className="character-count">{notes.length} / 1,000</div>
      </details>
      </fieldset>
      {!readOnly && <div className="save-bar">
        <span className={!completeness.complete || dirty ? "unsaved" : "saved"}>
          {!completeness.complete ? (
            <><CircleHelp size={16} />{t("{count} box(es) left to fill in", { count: completeness.missing.length })}</>
          ) : dirty ? (
            <>
              <span />
              {t("Unsaved changes")}
            </>
          ) : entry ? (
            <>
              <CheckCircle2 size={16} />
              {t("All changes saved")}
            </>
          ) : (
            <>
              <CircleHelp size={16} />
              {t("Ready to save")}
            </>
          )}
        </span>
        <button
          className="button primary"
          type="submit"
          disabled={saving || !completeness.complete}
        >
          {saving ? (
            <LoaderCircle size={17} className="spin" />
          ) : (
            <Check size={17} />
          )}
          {saving ? t("Saving…") : t("Save resources")}
        </button>
      </div>}
    </form>
  );
}

function MembersManager({
  currentUser,
  notify,
  refresh,
}: {
  currentUser: Member;
  notify: (message: string, error?: boolean) => void;
  refresh: () => Promise<void>;
}) {
  const t = useT();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("active");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  type RosterSort = "member" | "role" | "status" | "strikes" | "updated" | "joined";
  const [historyFor, setHistoryFor] = useState<Member | null>(null);
  const [capacity, setCapacity] = useState(50);
  const [capacityDraft, setCapacityDraft] = useState("50");
  const [capacitySaving, setCapacitySaving] = useState(false);
  const load = useCallback(async () => {
    const results = await Promise.allSettled([
      api<MembersResponse>("/api/members"),
      api<{ settings: ClanSettings }>("/api/settings"),
    ]);
    if (results[0].status === "fulfilled") {
      setMembers(results[0].value.members);
      setError("");
    } else setError((results[0].reason as Error).message);
    if (results[1].status === "fulfilled") {
      setCapacity(results[1].value.settings.capacity);
      setCapacityDraft(String(results[1].value.settings.capacity));
    } else {
      const message = (results[1].reason as Error).message;
      setError((previous) => previous || message);
    }
    setLoading(false);
  }, []);
  async function saveCapacity(event: FormEvent) {
    event.preventDefault();
    const value = Number(capacityDraft);
    if (!Number.isInteger(value) || value < 1 || value > 1000) {
      notify("Clan capacity must be a whole number between 1 and 1,000.", true);
      return;
    }
    setCapacitySaving(true);
    try {
      const result = await api<{ settings: ClanSettings }>("/api/settings", { method: "PATCH", body: JSON.stringify({ capacity: value }) });
      setCapacity(result.settings.capacity);
      await refresh();
      notify("Clan capacity saved.");
    } catch (e) { notify((e as Error).message, true); }
    finally { setCapacitySaving(false); }
  }
  useEffect(() => {
    void load();
  }, [load]);
  async function change(
    member: Member,
    patch: { role?: "ADMIN" | "MEMBER"; active?: boolean },
  ) {
    if (
      patch.active === false &&
      !window.confirm(
        `Deactivate ${member.username}? Their saved entries will be retained, but they will lose access and be excluded from clan totals.`,
      )
    )
      return;
    if (
      patch.role &&
      !window.confirm(
        `${patch.role === "ADMIN" ? "Promote" : "Demote"} ${member.username} to ${patch.role.toLowerCase()}?`,
      )
    )
      return;
    setBusy(member.id);
    try {
      await api(`/api/members/${member.id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      await load();
      await refresh();
      notify("Member updated successfully.");
      if (member.id === currentUser.id) window.location.reload();
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setBusy(null);
    }
  }
  const shown = members
    .filter((member) =>
      member.username.toLowerCase().includes(search.toLowerCase()),
    )
    .filter(
      (member) => filter === "all" || member.active === (filter === "active"),
    );
  const { sorted: filtered, sort: rosterSort, setSort: setRosterSort, header: rosterHeader } = useSortable<Member, RosterSort>(shown, {
    member: (member) => member.username,
    role: (member) => member.role === "ADMIN" ? "Admin" : "Member",
    status: (member) => member.active ? (member.holidayUntil ? "Holiday" : "Active") : "Inactive",
    strikes: (member) => member.strikes ?? 0,
    // Never-updated members count as the oldest.
    updated: (member) => new Date(member.lastUpdatedAt ?? 0).getTime(),
    joined: (member) => new Date(member.joinedAt).getTime(),
  }, { key: "updated", direction: "asc" });
  const sort = rosterSort.key === "member" ? "alphabetical" : rosterSort.key === "updated" ? (rosterSort.direction === "asc" ? "oldest" : "newest") : "";
  const setSort = (value: string) => setRosterSort(value === "alphabetical" ? { key: "member", direction: "asc" } : { key: "updated", direction: value === "newest" ? "desc" : "asc" });
  const activeCount = members.filter((member) => member.active).length;
  const openSlots = Math.max(0, capacity - activeCount);
  return (
    <>
      <div className="management-stats">
        <article className="panel">
          <Users size={21} />
          <strong>{activeCount}/{capacity}</strong>
          <span>Active registered members</span>
        </article>
        <article className="panel">
          <ShieldCheck size={21} />
          <strong>
            {members.filter((m) => m.active && m.role === "ADMIN").length}
          </strong>
          <span>Clan admins</span>
        </article>
        <article className="panel">
          <Swords size={21} />
          <strong>{openSlots}</strong>
          <span>{activeCount > capacity ? `${activeCount - capacity} above capacity` : "Open clan slots"}</span>
        </article>
      </div>
      <form className="capacity-form panel" onSubmit={saveCapacity}>
        <div><h2>Clan capacity</h2><p>Counts reflect active members registered on this tracker.</p></div>
        <label><span>Member capacity</span><input aria-label="Member capacity" type="number" min="1" max="1000" step="1" value={capacityDraft} onChange={(event) => setCapacityDraft(event.target.value)} /></label>
        <button className="button secondary" type="submit" disabled={capacitySaving}>{capacitySaving ? "Saving…" : "Save capacity"}</button>
      </form>
      <div className="entry-notice">
        <ShieldCheck size={17} />
        <span>
          Members join through Discord. Deactivating a member preserves their
          history and removes them from clan totals.
        </span>
      </div>
      <section className="panel">
        <div className="table-section-heading">
          <div>
            <h2>The Turmoil roster</h2>
            <p>Manage access and admin permissions.</p>
          </div>
          <label className="search-input">
            <Search size={16} />
            <input
              aria-label="Search roster"
              placeholder="Search members…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
        </div>
        <div className="table-tabs">
          {["active", "inactive", "all"].map((item) => (
            <button
              key={item}
              className={filter === item ? "active" : ""}
              onClick={() => setFilter(item)}
            >
              {item === "all"
                ? "All members"
                : `${item[0].toUpperCase()}${item.slice(1)} members`}
            </button>
          ))}
        </div>
        <div className="roster-tools">
          <label><span>Sort</span><select aria-label="Sort roster" value={sort} onChange={(event) => setSort(event.target.value)}>{sort === "" && <option value="">By column</option>}<option value="oldest">Oldest update first</option><option value="newest">Newest update first</option><option value="alphabetical">A–Z</option></select></label>
          <div className="freshness-legend"><span className="freshness fresh"><i />Under 24h</span><span className="freshness aging"><i />1–7 days</span><span className="freshness stale"><i />A week or never</span></div>
        </div>
        {error && (
          <div className="error-banner" role="alert">
            {error}
            <button onClick={load}>Retry</button>
          </div>
        )}
        <div className="table-scroll">
          <table className="management-table">
            <thead>
              <tr>
                {rosterHeader("member", "Member")}
                {rosterHeader("role", "Role")}
                {rosterHeader("status", "Status")}
                {rosterHeader("strikes", "Strikes")}
                {rosterHeader("updated", "Last resource update")}
                {rosterHeader("joined", "Joined")}
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((member) => (
                <tr key={member.id}>
                  <td>
                    <div className="table-member">
                      <Avatar member={member} />
                      <div>
                        <strong>
                          <MemberName member={member} />
                          {member.id === currentUser.id && (
                            <span className="you-badge">{t("you")}</span>
                          )}
                        </strong>
                        <MemberTitle member={member} />
                        <span>Discord · {member.discordId}{member.neverSignedIn ? " · Never signed in" : ""}</span>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span
                      className={`role-badge ${member.role === "ADMIN" ? "admin-role" : ""}`}
                    >
                      {member.role === "ADMIN" && <ShieldCheck size={12} />}
                      {member.role === "ADMIN" ? "Admin" : "Member"}
                    </span>
                  </td>
                  <td>
                    <span
                      className={`status-badge ${member.active ? "active-status" : "inactive-status"}`}
                    >
                      <i />
                      {member.active ? (member.holidayUntil ? `Holiday until ${member.holidayUntil}` : "Active") : "Inactive"}
                    </span>
                  </td>
                  <td>
                    <span className={`roster-strikes ${(member.strikes ?? 0) > 0 ? "has" : ""}`}>{member.strikes ?? 0}</span>
                  </td>
                  <td
                    title={
                      member.lastUpdatedAt
                        ? new Date(member.lastUpdatedAt).toLocaleString()
                        : ""
                    }
                  >
                    <Freshness date={member.lastUpdatedAt} />
                  </td>
                  <td>
                    {new Date(member.joinedAt).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </td>
                  <td>
                    <div className="member-actions">
                      <button className="button secondary small-button" onClick={() => setHistoryFor(member)}>
                        <History size={13} />
                        Holiday, strikes & history
                      </button>
                      <button
                        className="button secondary small-button"
                        disabled={busy !== null || !member.active}
                        onClick={() =>
                          change(member, {
                            role: member.role === "ADMIN" ? "MEMBER" : "ADMIN",
                          })
                        }
                      >
                        {busy === member.id ? (
                          <LoaderCircle size={13} className="spin" />
                        ) : (
                          <ShieldCheck size={13} />
                        )}
                        {member.role === "ADMIN" ? "Demote" : "Make admin"}
                      </button>
                      <button
                        className={`button subtle small-button ${member.active ? "danger-text" : ""}`}
                        disabled={busy !== null || member.id === currentUser.id}
                        onClick={() =>
                          change(member, { active: !member.active })
                        }
                      >
                        {member.active ? "Deactivate" : "Reactivate"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {loading && (
            <div className="table-empty">
              <LoaderCircle className="spin" size={20} />
              <p>Loading members…</p>
            </div>
          )}
          {!loading && !filtered.length && (
            <div className="table-empty">
              <Users size={24} />
              <p>{t("No members match this view.")}</p>
            </div>
          )}
        </div>
        <div className="table-footer">
          <span>{filtered.length} members</span>
          <button className="button subtle small-button" onClick={() => downloadRows(`turmoil-members-${new Date().toISOString().slice(0, 10)}.csv`, [
            ["Member", "Discord ID", "Role", "Status", "Holiday until", "Strikes", "Last resource update", "Joined", "Never signed in"],
            ...filtered.map((member) => [member.username, member.discordId, member.role, member.active ? "Active" : "Inactive", member.holidayUntil ?? "", String(member.strikes ?? 0), member.lastUpdatedAt ?? "", member.joinedAt, member.neverSignedIn ? "Yes" : ""]),
          ])}><ArrowDownToLine size={13} />Export CSV</button>
          <span>At least one active admin is always required</span>
        </div>
      </section>
      {historyFor && <MemberHistoryPanel member={historyFor} notify={notify} onClose={() => setHistoryFor(null)} onChanged={() => { void load(); void refresh(); }} />}
    </>
  );
}

function Weeks({
  data,
  week,
  selectWeek,
  notify,
  refresh,
}: {
  data: DashboardResponse;
  week: string;
  selectWeek: (value: string) => void;
  notify: (message: string, error?: boolean) => void;
  refresh: () => Promise<void>;
}) {
  const weeks = [...new Set([currentWeek(), week, ...data.weeks])]
    .sort()
    .reverse();
  return (
    <>
      <section className="archive-intro panel">
        <CalendarDays size={28} />
        <div>
          <h2>Weekly history</h2>
          <p>
            Weekly bank snapshots keep resource totals fixed, including the roster
            at capture time. Compare movements or revisit a saved dashboard.
          </p>
        </div>
        <span className="count-badge">{data.weeks.length} saved weeks</span>
      </section>
      <WarTotalsHistory />
      <WarTotalsHistory kind="vials" />
      <BankHistory admin={data.currentUser.role === "ADMIN"} notify={notify} refresh={refresh} />
      <div className="weeks-grid">
        {weeks.map((item) => (
          <article
            className={`week-card panel ${item === week ? "selected-week" : ""}`}
            key={item}
          >
            <div>
              <span className="week-card-icon">
                <CalendarDays size={23} />
              </span>
              {item === currentWeek() && (
                <span className="status-badge active-status">
                  <i />
                  Current week
                </span>
              )}
            </div>
            <h2>Week of {formatWeek(item)}</h2>
            <p>
              {formatWeek(item)} – {formatWeek(shiftDate(item, 6))}
            </p>
            {item === week && (
              <div className="week-card-stats">
                <span>
                  <Users size={15} />
                  {data.stats.submittedMembers} contributions
                </span>
                <span>
                  {numberFormat(data.totals.skillTickets)} skill tickets
                </span>
              </div>
            )}
            <div className="week-card-actions">
              <Link className="button secondary" href={`/?week=${item}`}>
                View dashboard
                <ArrowUpRight size={15} />
              </Link>
              {item !== week && (
                <button
                  className="icon-button"
                  aria-label={`Select week of ${item}`}
                  onClick={() => selectWeek(item)}
                >
                  <ChevronRight size={18} />
                </button>
              )}
              {item === week && (
                <span className="selected-label">
                  <Check size={14} />
                  Selected
                </span>
              )}
            </div>
          </article>
        ))}
      </div>
      <div className="archive-note">
        <CircleHelp size={16} />
        <span>
          Weeks begin Monday 00:00 UTC. Historical views are read-only; live
          banks carry forward.
        </span>
      </div>
    </>
  );
}
function shiftDate(week: string, days: number) {
  const date = new Date(`${week}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
function DashboardSkeleton() {
  return (
    <div
      className="dashboard-skeleton"
      aria-label="Loading resources"
      aria-busy="true"
    >
      <div className="skeleton skeleton-hero" />
      <div className="stat-grid arsenal-grid">
        {[...dashboardResources, { key: "war-summary" }].map((item) => (
          <div className="skeleton skeleton-stat" key={item.key} />
        ))}
      </div>
    </div>
  );
}
