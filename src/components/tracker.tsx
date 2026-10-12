"use client";

import Link from "next/link";
import { ClanBrand } from "./clan-brand";
import { BankHistory } from "./bank-history";
import { WarPlanner } from "./war-planner";
import { SnipePlanner } from "./snipe-planner";
import { DewStore } from "./dew-store";
import { DEW_ITEMS } from "@/lib/dew";
import { DEFAULT_WAR_RATES, estimateWar } from "@/lib/war";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type FormEvent,
} from "react";
import {
  ArrowDownToLine,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Droplets,
  Target,
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
  CircleHelp,
  Clipboard,
  Egg,
  Flame,
  Hammer,
  KeyRound,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  Menu,
  PawPrint,
  Search,
  ShieldCheck,
  Sparkles,
  Swords,
  Ticket,
  Users,
  X,
} from "lucide-react";
import {
  EMPTY_RESOURCES,
  EMPTY_PLANNING_DETAILS,
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
  ClanSettings,
  DashboardResponse,
  EntryResponse,
  Member,
  MembersResponse,
  SessionResponse,
} from "@/lib/types";

type View = "dashboard" | "resources" | "members" | "weeks" | "war" | "snipes" | "store";
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
  snipes: "Snipe Plans",
  store: "Dew Store",
};
const navigation: { view: View; href: string; icon: Icon }[] = [
  { view: "dashboard", href: "/", icon: LayoutDashboard },
  { view: "resources", href: "/resources", icon: Backpack },
  { view: "war", href: "/war-points", icon: Swords },
  { view: "snipes", href: "/snipes", icon: Target },
  { view: "store", href: "/dew-store", icon: Droplets },
  { view: "members", href: "/members", icon: Users },
  { view: "weeks", href: "/weeks", icon: CalendarDays },
];
const essentials: {
  key: ResourceKey;
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

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
    cache: "no-store",
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error || "Something went wrong. Please try again.");
    Object.assign(error, { status: response.status, code: data.code });
    throw error;
  }
  return data as T;
}
function ago(date: string | null) {
  if (!date) return "Not yet updated";
  const minutes = Math.max(
    0,
    Math.round((Date.now() - new Date(date).getTime()) / 60000),
  );
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / 1440)}d ago`;
}
function MemberBadge({ member }: { member: Member }) {
  const badge = DEW_ITEMS.find((item) => item.id === member.badge);
  return badge ? <span className="member-cosmetic" title={badge.name} aria-label={badge.name}>{badge.symbol}</span> : null;
}
function freshness(date: string | null) {
  if (!date) return { color: "stale", label: "Never updated" };
  const elapsed = Math.max(0, Date.now() - new Date(date).getTime());
  if (elapsed < 24 * 60 * 60 * 1000) return { color: "fresh", label: "Updated under 24 hours ago" };
  if (elapsed < 7 * 24 * 60 * 60 * 1000) return { color: "aging", label: "Updated 1–7 days ago" };
  return { color: "stale", label: "Updated a week ago or longer" };
}
function Freshness({ date }: { date: string | null }) {
  const status = freshness(date);
  return <span className={`freshness ${status.color}`} title={status.label}><i aria-hidden="true" />{date ? ago(date) : "Never updated"}</span>;
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
function Avatar({
  member,
  small = false,
}: {
  member: Pick<Member, "username" | "avatarUrl">;
  small?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [member.avatarUrl]);
  const hue =
    [...member.username].reduce((acc, char) => acc + char.charCodeAt(0), 0) %
    360;
  return (
    <span
      className={`avatar ${small ? "small" : ""}`}
      style={{
        background: `hsl(${hue} 22% 25%)`,
        color: `hsl(${hue} 55% 80%)`,
      }}
    >
      {member.avatarUrl && !failed ? (
        <img
          src={member.avatarUrl}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        member.username.slice(0, 2).toUpperCase()
      )}
    </span>
  );
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
        if (sessionUserId && ["dashboard", "war", "snipes"].includes(view)) void refresh();
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
    if (!["dashboard", "war", "snipes"].includes(view) || !sessionUserId) return;
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
    const csv = `Resource,Total\r\n${RESOURCE_FIELDS.map(({ key, label }) => `${label},${data.totals[key as ResourceKey]}`).join("\r\n")}\r\n`;
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8;" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `turmoil-resources-${week}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    notify("Weekly totals exported as CSV.");
  }
  async function copyTotals() {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(
        `Turmoil · Week of ${week}\n${RESOURCE_FIELDS.map(({ key, label }) => `${label}: ${numberFormat(data.totals[key as ResourceKey])}`).join("\n")}`,
      );
      notify("Clan totals copied to your clipboard.");
    } catch {
      notify("Clipboard unavailable. Use Export CSV instead.", true);
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
            <h2>Couldn’t connect to the tracker</h2>
            <p>{sessionError}</p>
            <button
              className="button primary"
              onClick={() => window.location.reload()}
            >
              Try again
            </button>
          </>
        ) : (
          <>
            <LoaderCircle className="spin" size={22} />
            <p>Opening the forge…</p>
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
  const denied = view === "members" && user.role !== "ADMIN";
  const dataMatches = !!data && data.week === week && loadedSnapshotId === snapshotId;
  const ownEntry = data?.entries.find((entry) => entry.memberId === user.id);
  let dashboardWar: ReturnType<typeof estimateWar> | null = null;
  let warEstimateError = "";
  if (data) {
    try { dashboardWar = estimateWar(data.entries, warRates, ["hammers", "skillSummons", "mountSummons", "mountMerges"]); }
    catch (e) { warEstimateError = (e as Error).message; }
  }
  return (
    <div className="app-shell">
      {mobileOpen && (
        <button
          className="sidebar-scrim"
          aria-label="Close navigation"
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
            <small>RESOURCE TRACKER</small>
          </span>
        </Link>
        <span className="sidebar-label">CLAN WORKSPACE</span>
        <nav aria-label="Main navigation">
          {navigation
            .filter((item) => item.view !== "members" || user.role === "ADMIN")
            .map(({ view: target, href, icon: NavIcon }) => (
              <Link
                href={href}
                key={target}
                className={`nav-link ${target === view ? "active" : ""}`}
                onClick={() => setMobileOpen(false)}
              >
                <NavIcon size={19} />
                <span>{viewNames[target]}</span>
                {target === "members" && (
                  <span className="nav-admin">
                    <ShieldCheck size={13} />
                  </span>
                )}
                {target === view && <span className="nav-active-dot" />}
              </Link>
            ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="game-card">
            <Swords size={22} />
            <div>
              <strong>Forge Masters</strong>
              <span>Built for the next battle.</span>
            </div>
          </div>
          <button className="nav-link help-link" onClick={() => setHelp(true)}>
            <CircleHelp size={18} />
            Tracker guide
            <ArrowUpRight size={14} />
          </button>
          <div className="sidebar-profile">
            <Avatar member={user} />
            <div>
              <strong>{user.username}<MemberBadge member={user} /></strong>
              <span>
                {user.role === "ADMIN" ? "Clan admin" : "Clan member"}
              </span>
            </div>
            <button
              className="icon-button"
              title="Sign out"
              aria-label="Sign out"
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
              aria-label="Open navigation"
              onClick={() => setMobileOpen(true)}
            >
              <Menu size={22} />
            </button>
            <span>Clan workspace</span>
            <ChevronRight size={13} />
            <strong>{viewNames[view]}</strong>
          </div>
          <div className="topbar-actions">
            {session.demo && <span className="demo-pill">Demo workspace</span>}
            <span className="connection">
              <i />
              Clan connected
            </span>
            <div className="notification-wrap">
              <button
                className={`icon-button ${notifications ? "selected" : ""}`}
                aria-label="Recent activity"
                onClick={() => setNotifications(!notifications)}
              >
                <Bell size={19} />
                <span className="notification-dot" />
              </button>
              {notifications && (
                <div className="notification-panel">
                  <h3>Recent clan activity</h3>
                  {data?.entries
                    .slice()
                    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
                    .slice(0, 4)
                    .map((entry) => (
                      <div key={entry.id}>
                        <CheckCircle2 size={17} />
                        <p>
                          <strong>{entry.updatedBy.username}</strong> updated
                          resources<small>{ago(entry.updatedAt)}</small>
                        </p>
                      </div>
                    ))}
                  {!data?.entries.length && <p>No resource bank updates yet.</p>}
                </div>
              )}
            </div>
            <Avatar member={user} small />
          </div>
        </header>
        <main className="main-content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                {view === "dashboard"
                  ? "CLAN OVERVIEW"
                  : view === "resources"
                    ? "YOUR CONTRIBUTION"
                    : view === "members"
                      ? "CLAN ROSTER"
                      : view === "war" ? "BATTLE PREPARATION"
                        : view === "snipes" ? "PLAN TOGETHER"
                          : view === "store" ? "YOUR CLAN REWARDS" : "THE CLAN ARCHIVE"}
              </div>
              <h1>
                {view === "dashboard" ? "Resource Dashboard" : viewNames[view]}
              </h1>
              <p>
                {view === "dashboard"
                  ? "Every resource. Every member. One stronger clan."
                  : view === "resources"
                    ? "Keep your arsenal up to date. Make every resource count."
                    : view === "members"
                      ? "A stronger clan starts with the people behind it."
                      : view === "war" ? "Choose activities and estimate the clan’s next battle."
                        : view === "snipes" ? "Organise events, share availability, and prepare together."
                          : view === "store" ? "Earn Dew for keeping your bank current. Wear your clan rewards."
                            : "Fixed weekly snapshots and changes in the clan’s resources."}
              </p>
            </div>
            {["dashboard", "resources", "weeks"].includes(view) && (
              <div className="week-control">
                <button
                  className="icon-button"
                  aria-label="Previous week"
                  onClick={() => selectWeek(shiftWeek(week, -1))}
                >
                  <ChevronLeft size={17} />
                </button>
                <label className="week-picker">
                  <CalendarDays size={16} />
                  <span>Week of {formatWeek(week)}</span>
                  <ChevronDown size={14} />
                  <input
                    aria-label="Select week"
                    type="date"
                    value={week}
                    onChange={(e) =>
                      e.target.value && selectWeek(e.target.value)
                    }
                  />
                </label>
                <button
                  className="icon-button"
                  aria-label="Next week"
                  onClick={() => selectWeek(shiftWeek(week, 1))}
                >
                  <ChevronRight size={17} />
                </button>
              </div>
            )}
          </div>
          {error && (
            <div className="error-banner" role="alert">
              <span>{error}</span>
              <button onClick={refresh}>Retry</button>
            </div>
          )}
          {denied ? (
            <section className="empty-state">
              <ShieldCheck size={32} />
              <h2>Admin access required</h2>
              <p>Only clan admins can manage the member roster.</p>
              <Link href="/" className="button primary">
                Back to dashboard
              </Link>
            </section>
          ) : !dataMatches && loading ? (
            <DashboardSkeleton />
          ) : data && dataMatches && view === "dashboard" ? (
            <>
              <section className="hero">
                <div className="hero-copy">
                  <span className="hero-eyebrow">
                    <span /> UNITED WE FORGE
                  </span>
                  <h2>Stronger, together.</h2>
                  <p>
                    Your resources are the clan’s next advantage.{" "}
                    <br />
                    Track your arsenal. Prepare for what’s ahead.
                  </p>
                  <Link
                    href={`/resources?week=${week}${snapshotId ? `&snapshot=${encodeURIComponent(snapshotId)}` : ""}`}
                    className="button primary"
                  >
                    {data.live === false ? "View saved resources" : ownEntry ? "Update my resources" : "Add my resources"}
                    <ArrowRight size={16} />
                  </Link>
                </div>
                <ClanBrand
                  variant="full"
                  className="hero-crest"
                  size={360}
                  sizes="(max-width: 650px) 125px, (max-width: 1100px) 260px, 360px"
                  decorative
                />
                <span className="hero-tag">
                  <Sparkles size={13} />
                  THE TURMOIL WAY
                </span>
                <div className="hero-participation">
                  <div className="avatar-stack">
                    {data.members.slice(0, 4).map((member) => (
                      <Avatar member={member} small key={member.id} />
                    ))}
                  </div>
                  <div>
                    <strong>
                      {data.stats.submittedMembers} of {data.stats.totalMembers}{" "}
                      members
                    </strong>
                    <span>{data.live === false ? "had resources in this saved week" : "have a saved resource bank"}</span>
                  </div>
                  <div className="participation-track">
                    <i
                      style={{
                        width: `${data.stats.totalMembers ? (data.stats.submittedMembers / data.stats.totalMembers) * 100 : 0}%`,
                      }}
                    />
                  </div>
                </div>
              </section>
              <div className="section-heading">
                <div>
                  <h2>
                    {data.live === false ? "Saved weekly arsenal" : "The clan’s current arsenal"}{" "}
                    <span className="live-badge">
                      <i />
                      {data.live === false ? "READ-ONLY HISTORY" : "LIVE TOTALS"}
                    </span>
                  </h2>
                  <p>{data.live === false ? "Historical totals are preserved with the roster at capture time." : "Combined persistent banks from all active Turmoil members."}</p>
                </div>
                <div className="section-actions">
                  <button className="button subtle" onClick={copyTotals}>
                    <Clipboard size={15} />
                    <span>Copy totals</span>
                  </button>
                  <button className="button secondary" onClick={downloadCsv}>
                    <ArrowDownToLine size={15} />
                    Export CSV
                  </button>
                </div>
              </div>
              {warEstimateError && <div className="error-banner" role="alert">War estimate unavailable: {warEstimateError}</div>}
              <div className="stat-grid">
                {dashboardResources.map(({ key, label, icon: StatIcon, color }) => {
                  if (key === "eggsPetsTotal") {
                    return <EggsPetsCard key={key} total={data.totals.eggsPetsTotal} />;
                  }
                  const summons =
                    key === "skillTickets"
                      ? {
                          label: "Total skill summons",
                          total: dashboardWar?.rows.find((row) => row.activity === "skillSummons")?.quantity ?? 0,
                          missing: data.summons?.missingSkillCosts ?? 0,
                        }
                      : key === "mountKeys"
                        ? {
                            label: "Total mount summons",
                            total: dashboardWar?.rows.find((row) => row.activity === "mountSummons")?.quantity ?? 0,
                            missing: data.summons?.missingMountCosts ?? 0,
                          }
                        : null;
                  const warPoints =
                    key === "skillTickets"
                      ? {
                          total: warEstimateError ? "--" : numberFormat(dashboardWar?.rows.find((row) => row.activity === "skillSummons")?.minimum ?? 0),
                          note: `${numberFormat(warRates.skillSummons)} points per skill summon.`,
                        }
                      : key === "mountsToMerge"
                        ? {
                            total: warEstimateError ? "--" : numberFormat(dashboardWar?.rows.find((row) => row.activity === "mountMerges")?.minimum ?? 0),
                            note: `${numberFormat(warRates.mountMerges)} points per mount to merge.`,
                          }
                        : key === "hammers"
                          ? {
                              total: warEstimateError ? "--" : `${numberFormat(data.totals.hammers * warRates.hammersMin)}–${numberFormat(data.totals.hammers * warRates.hammersMax)}`,
                              note: `${numberFormat(warRates.hammersMin)}–${numberFormat(warRates.hammersMax)} points per hammer.`,
                            }
                          : null;
                  return (
                    <article
                      className={`stat-card ${summons ? "has-summons" : ""} ${warPoints ? "has-war-points" : ""}`}
                      key={key}
                    >
                      <div className="stat-label">
                        <span className={`resource-icon ${color}`}>
                          <StatIcon size={20} strokeWidth={1.8} />
                        </span>
                        <span>{label}</span>
                      </div>
                      <strong className="stat-number">
                        {numberFormat(data.totals[key])}
                      </strong>
                      {summons && (
                        <div className="stat-summons">
                          <span className="summon-label">{summons.label}</span>
                          <strong className="summon-total">
                            {warEstimateError ? "--" : new Intl.NumberFormat("en-US", {
                              minimumFractionDigits: 0,
                              maximumFractionDigits: 0,
                            }).format(summons.total)}
                          </strong>
                          <span className="summon-note">
                            Whole summons calculated per member.
                          </span>
                          {summons.missing > 0 && (
                            <p className="summon-warning">
                              Incomplete: {summons.missing}{" "}
                              {summons.missing === 1 ? "member" : "members"}{" "}
                              missing a cost.
                            </p>
                          )}
                        </div>
                      )}
                      {warPoints && (
                        <div className="stat-war-points">
                          <span className="war-points-label">
                            Potential clan war points
                          </span>
                          <strong className="war-points-total">
                            {warPoints.total}
                          </strong>
                          <span className="war-points-note">
                            {warPoints.note}
                          </span>
                        </div>
                      )}
                      <span className="stat-foot">
                        <span />
                        Ready for the clan
                      </span>
                    </article>
                  );
                })}
              </div>
              <MemberResources
                data={data}
                week={week}
                admin={user.role === "ADMIN"}
                snapshotId={snapshotId}
              />
            </>
          ) : data && dataMatches && view === "resources" ? (
            <ResourceForm
              data={data}
              week={week}
              memberId={params.get("member")}
              snapshotId={snapshotId}
              notify={notify}
              refresh={refresh}
            />
          ) : data && view === "members" ? (
            <MembersManager currentUser={user} notify={notify} refresh={refresh} />
          ) : data && dataMatches && view === "weeks" ? (
            <Weeks data={data} week={week} selectWeek={selectWeek} notify={notify} refresh={refresh} />
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
              FORGED FOR TURMOIL
            </span>
            <span>Plan together. Forge ahead.</span>
          </footer>
        </main>
      </div>
      {toast && (
        <div
          className={`toast ${toast.error ? "toast-error" : ""}`}
          role="status"
        >
          {toast.error ? <X size={18} /> : <CheckCircle2 size={18} />}
          {toast.message}
          <button
            className="icon-button"
            aria-label="Dismiss notification"
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
            aria-label="Tracker guide"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="icon-button modal-close"
              aria-label="Close guide"
              onClick={() => setHelp(false)}
            >
              <X size={20} />
            </button>
            <span className="brand-mark">
              <ClanBrand decorative />
            </span>
            <h2>Your clan’s resource hub.</h2>
            <p>
              Your bank carries forward until you update it. Save your current
              Forge Masters resources in My Resources; clan totals change immediately.
              Weekly history records fixed snapshots at Monday 00:00 UTC
              (10am AEST or 11am AEDT in Sydney).
            </p>
            <div className="guide-row">
              <Backpack size={20} />
              <div>
                <strong>Update your arsenal</strong>
                <p>
                  Resource amounts are whole numbers. Your costs, levels, and
                  inventory stay saved, so you only change what has changed.
                </p>
              </div>
            </div>
            <div className="guide-row">
              <CalendarDays size={20} />
              <div>
                <strong>Browse any week</strong>
                <p>
                  Use the date picker or Weekly History to see fixed snapshots.
                  Past views are read-only and never change your live bank.
                </p>
              </div>
            </div>
            <div className="guide-row">
              <ShieldCheck size={20} />
              <div>
                <strong>A workspace for your clan</strong>
                <p>
                  Discord verifies your membership. Admins can edit entries and
                  manage members. Inactive members are excluded from totals.
                </p>
              </div>
            </div>
            <button className="button primary" onClick={() => setHelp(false)}>
              Got it
              <Check size={16} />
            </button>
          </section>
        </div>
      )}
    </div>
  );
}

function Login({ configured, error }: { configured: boolean; error: string }) {
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
      <div className="login-stage">
        <div className="login-art">
          <ClanBrand
            variant="full"
            className="login-crest"
            size={480}
            sizes="(max-width: 650px) 195px, (max-width: 900px) 340px, 480px"
          />
          <span className="crest-caption">FORGED IN UNITY</span>
        </div>
        <section className="login-card">
          <div className="eyebrow">THE TURMOIL RESOURCE TRACKER</div>
          <h1>
            One clan.
            <br />
            <span>Endless potential.</span>
          </h1>
          <p>
            Your Forge Masters arsenal, united.
            <br />
            Sign in once in this browser. We keep you signed in on this device.
          </p>
          {message && (
            <div className="error-banner" role="alert">
              {message}
            </div>
          )}
          <a
            className={`button discord-button ${!configured ? "disabled" : ""}`}
            href={configured ? "/api/auth/login" : undefined}
            aria-disabled={!configured}
          >
            <DiscordIcon />
            Continue with Discord
            <ArrowRight size={17} />
          </a>
          <p className="login-device-note">Sign in again if you sign out, clear cookies, use private browsing, or your device session expires.</p>
          <div className="login-security">
            <ShieldCheck size={15} />
            Exclusively for members of the Turmoil clan
          </div>
          {!configured && (
            <p className="login-config">
              Discord login is awaiting configuration. Follow the repository setup
              guide to connect your Discord application.
            </p>
          )}
        </section>
      </div>
      <footer>Plan together. Forge ahead.</footer>
    </main>
  );
}

function EggsPetsCard({ total }: { total: number }) {
  return (
    <article className="stat-card eggs-pets-card">
      <div className="eggs-pets-heading">
        <div className="eggs-pets-icons" aria-hidden="true">
          <span className="resource-icon gold">
            <Egg size={21} />
          </span>
          <span className="resource-icon green">
            <PawPrint size={19} />
          </span>
        </div>
        <div className="eggs-pets-copy">
          <h3>Total eggs/pets</h3>
          <p>All eggs and pets combined across the clan.</p>
        </div>
      </div>
      <div className="eggs-pets-total">
        <strong>{numberFormat(total)}</strong>
        <span>Ready for the clan</span>
      </div>
    </article>
  );
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
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("all");
  type ContributionSort = "username" | "updatedAt" | ResourceKey;
  const [sort, setSort] = useState<{ key: ContributionSort; direction: "asc" | "desc" }>({ key: "username", direction: "asc" });
  const entries = new Map(data.entries.map((entry) => [entry.memberId, entry]));
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
    .filter((member) => tab === "all" || (tab === "submitted" ? entries.has(member.id) : !entries.has(member.id)))
    .sort((a, b) => {
      const value = (member: Member) => sort.key === "username" ? member.username : sort.key === "updatedAt"
        ? new Date(entries.get(member.id)?.updatedAt ?? 0).getTime()
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
            Member contributions{" "}
            <span className="count-badge">{data.stats.totalMembers}</span>
          </h2>
          <p>Every contribution brings us closer to the next victory.</p>
        </div>
        <label className="search-input">
          <Search size={16} />
          <input
            placeholder="Search members…"
            aria-label="Search contributions"
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
          All members<span>{data.stats.totalMembers}</span>
        </button>
        <button
          className={tab === "submitted" ? "active" : ""}
          onClick={() => setTab("submitted")}
        >
          Updated<span>{data.stats.submittedMembers}</span>
        </button>
        <button
          className={tab === "pending" ? "active" : ""}
          onClick={() => setTab("pending")}
        >
          Pending<span>{data.stats.pendingMembers}</span>
        </button>
        <span className="table-scroll-hint">
          Scroll to explore all resources
          <ArrowRight size={13} />
        </span>
      </div>
      <div className="table-scroll">
        <table className="resource-table">
          <thead>
            <tr>
              <th className="sticky-member" aria-sort={sortOrder("username")}><button className="column-sort" onClick={() => changeSort("username")}>Member {sortIcon("username")}</button></th>
              {RESOURCE_FIELDS.map(({ key, label }) => {
                const FieldIcon =
                  key === "eggsPetsTotal"
                    ? Egg
                    : (essentials.find((field) => field.key === key)?.icon ??
                      Backpack);
                return (
                  <th key={key} aria-sort={sortOrder(key)}>
                    <button className="column-sort" onClick={() => changeSort(key)}>
                      <FieldIcon size={14} aria-hidden="true" />{label}{sortIcon(key)}
                    </button>
                  </th>
                );
              })}
              <th aria-sort={sortOrder("updatedAt")}><button className="column-sort" onClick={() => changeSort("updatedAt")}>Last updated {sortIcon("updatedAt")}</button></th>
              <th>Notes</th>
              {admin && <th>Edit</th>}
            </tr>
          </thead>
          <tbody>
            {members.map((member) => {
              const entry = data.entries.find(
                (item) => item.memberId === member.id,
              );
              const resources = entry?.resources ?? EMPTY_RESOURCES;
              return (
                <tr key={member.id}>
                  <td className="sticky-member">
                    <div className="table-member">
                      <Avatar member={member} small />
                      <div>
                        <strong>
                          {member.username}<MemberBadge member={member} />
                          {member.id === data.currentUser.id && (
                            <span className="you-badge">you</span>
                          )}
                        </strong>
                        <span>
                          <i
                            className={entry ? "updated-dot" : "pending-dot"}
                          />
                          {entry ? "Resources updated" : "Awaiting update"}
                        </span>
                      </div>
                    </div>
                  </td>
                  {RESOURCE_FIELDS.map(({ key }) => (
                    <td
                      key={key}
                      className={
                        key === "eggsPetsTotal" ? "accent-number" : undefined
                      }
                    >
                      {numberFormat(resources[key as ResourceKey])}
                    </td>
                  ))}
                  <td
                    className="updated-cell"
                    title={
                      entry ? new Date(entry.updatedAt).toLocaleString() : ""
                    }
                  >
                    {entry ? (
                      <>
                        <Freshness date={entry.updatedAt} />
                        <small>by {entry.updatedBy.username}</small>
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
                        {data.live === false ? "View" : "Edit"}
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
            <p>No members match this view.</p>
            <button
              className="text-link"
              onClick={() => {
                setSearch("");
                setTab("all");
              }}
            >
              Clear filters
            </button>
          </div>
        )}
      </div>
      <div className="table-footer">
        <span>
          Showing {members.length} of {data.members.length} members
        </span>
        <span>
          <i />
          Totals include active members only
        </span>
      </div>
    </section>
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
  const planningMaximum = (key: keyof PlanningDetails) => key.endsWith("Level") ? 1_000_000_000 : 1_000_000;
  const planningFields: { key: keyof PlanningDetails; label: string; help: string }[] = [
    { key: "skillLevel", label: "Skill level", help: "Saved for reference; costs are entered separately." },
    { key: "mountLevel", label: "Mount level", help: "Saved for reference; costs are entered separately." },
    { key: "eggLevel", label: "Egg/pet level", help: "Saved for reference; action counts are entered separately." },
    { key: "newMountMerges", label: "Newly summoned mount merges", help: "Merges planned from future mount summons; exclude existing mounts." },
    { key: "eggMerges", label: "Existing egg/pet merges", help: "Merges using eggs/pets already in your bank." },
    { key: "eggSummonMerges", label: "Egg/pet summon then merge", help: "Separate actions from future summons; exclude existing egg/pet merges." },
  ];
  const draftPlanning = (details: PlanningDetails) => Object.fromEntries(planningFields.map(({ key }) => [key, String(details[key])])) as Record<keyof PlanningDetails, string>;
  const [planningValues, setPlanningValues] = useState(() => draftPlanning(savedPlanning));
  const resourceKeys = RESOURCE_FIELDS.map(({ key }) => key as ResourceKey);
  const draftResources = (resources: ResourceValues) =>
    Object.fromEntries(
      resourceKeys.map((key) => [key, String(resources[key])]),
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
  const dirty =
    resourceKeys.some((key) => values[key] !== String(savedResources[key])) ||
    costValues.fiveSkills !== String(savedCosts.fiveSkills) ||
    costValues.mount !== String(savedCosts.mount) ||
    planningFields.some(({ key }) => planningValues[key] !== String(savedPlanning[key])) ||
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
  async function save(event: FormEvent) {
    event.preventDefault();
    if (readOnly) return;
    const planningDetails = Object.fromEntries(planningFields.map(({ key }) => [key, Number(planningValues[key])])) as unknown as PlanningDetails;
    const invalidPlanning = planningFields.find(({ key }) => !Number.isInteger(planningDetails[key]) || planningDetails[key] < 0 || planningDetails[key] > planningMaximum(key));
    if (invalidPlanning) {
      setFormError(`${invalidPlanning.label}: enter a whole number between 0 and ${numberFormat(planningMaximum(invalidPlanning.key))}.`);
      return;
    }
    const resources = Object.fromEntries(
      resourceKeys.map((key) => [
        key,
        values[key].trim() === "" ? 0 : Number(values[key]),
      ]),
    ) as ResourceValues;
    if (
      costValues.fiveSkills.trim() === "" ||
      costValues.mount.trim() === ""
    ) {
      setFormError("Enter both summoning costs.");
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
        `${invalidResource.label}: enter a whole number between 0 and ${numberFormat(resourceMaximum(invalidResource.key as ResourceKey))}.`,
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
        "Cost of summoning 5 skills must be between 150 and 200, with at most one decimal place.",
      );
      return;
    }
    if (
      !Number.isFinite(summoningCosts.mount) ||
      summoningCosts.mount < MOUNT_SUMMON_COST_MIN ||
      summoningCosts.mount > MOUNT_SUMMON_COST_MAX
    ) {
      setFormError("Cost per mount summon must be between 37.5 and 50.");
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
      await refresh();
      notify(
        `${selected.id === data.currentUser.id ? "Your" : selected.username + "’s"} resources are saved. Clan totals are up to date.`,
      );
    } catch (e) {
      setFormError((e as Error).message);
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
    <form className="resource-form" onSubmit={save}>
      <div className="entry-profile panel">
        <Avatar member={selected} />
        <div>
          <strong>
            {selected.username}
            <span className="role-badge">
              {selected.role === "ADMIN" ? "Admin" : "Member"}
            </span>
          </strong>
          <p>
            {entry
              ? `Last updated ${ago(entry.updatedAt)} by ${entry.updatedBy.username}`
              : "No saved resource bank yet."}
          </p>
        </div>
        {data.currentUser.role === "ADMIN" && (
          <label className="member-select">
            <span>{readOnly ? "Viewing member" : "Editing member"}</span>
            <select
              aria-label="Editing member"
              value={selected.id}
              onChange={(e) => {
                if (
                  dirty &&
                  !window.confirm(
                    "You have unsaved changes. Switch members without saving?",
                  )
                )
                  return;
                router.push(`/resources?week=${week}&member=${e.target.value}${snapshotId ? `&snapshot=${encodeURIComponent(snapshotId)}` : ""}`);
              }}
            >
              {data.members.map((member) => (
                <option value={member.id} key={member.id}>
                  {member.username}
                  {member.id === data.currentUser.id ? " (you)" : ""}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div className="entry-notice">
        <ShieldCheck size={17} />
        <span>
          {readOnly
            ? `Read-only history for the week of ${formatWeek(week)}. These saved amounts cannot be edited.`
            : "Your bank is shared with the clan and carries forward until you update it. Levels and costs stay saved."}
        </span>
      </div>
      <div className="section-heading">
        <div>
          <h2>{readOnly ? "Saved inventory" : "Your current inventory"}</h2>
          <p>Use whole numbers for resources and the ranges shown for costs.</p>
        </div>
        {readOnly && <Link className="button primary" href={`/resources${selected.id !== data.currentUser.id ? `?member=${selected.id}` : ""}`}>Return to live bank <ArrowRight size={15} /></Link>}
      </div>
      {formError && (
        <div className="error-banner" role="alert">
          {formError}
        </div>
      )}
      <fieldset className="bank-fields" disabled={readOnly || saving}>
      <section className="panel form-section">
        <h3>
          <Backpack size={19} />
          The essentials
        </h3>
        <div className="essential-inputs">
          {essentials.map(({ key, label, icon: InputIcon, color }) => {
            const costField =
              key === "skillTickets"
                ? {
                    key: "fiveSkills" as const,
                    label: "Cost of summoning 5 skills",
                    min: SKILL_SUMMON_COST_MIN,
                    max: SKILL_SUMMON_COST_MAX,
                    step: "0.1",
                    help: "Required: 150–200, up to one decimal place.",
                  }
                : key === "mountKeys"
                  ? {
                      key: "mount" as const,
                      label: "Cost per mount summon",
                      min: MOUNT_SUMMON_COST_MIN,
                      max: MOUNT_SUMMON_COST_MAX,
                      step: "any",
                      help: "Required: 37.5–50. Decimals allowed.",
                    }
                  : null;
            return (
              <div className="essential-field" key={key}>
                <label>
                  <span>
                    <InputIcon size={15} />
                    {label}
                  </span>
                  <div className={`number-input ${color}`}>
                    <input
                      aria-label={label}
                      type="number"
                      inputMode="numeric"
                      min="0"
                      max={resourceMaximum(key)}
                      step="1"
                      value={values[key]}
                      onChange={(e) => update(key, e.target.value)}
                    />
                  </div>
                </label>
                {costField && (
                  <label className="summoning-cost-field">
                    <span>{costField.label}</span>
                    <input
                      aria-label={costField.label}
                      aria-describedby={`summoning-cost-help-${costField.key}`}
                      type="number"
                      inputMode="decimal"
                      min={costField.min}
                      max={costField.max}
                      step={costField.step}
                      required
                      value={costValues[costField.key]}
                      onChange={(e) =>
                        setCostValues((existing) => ({
                          ...existing,
                          [costField.key]: e.target.value,
                        }))
                      }
                    />
                    <small id={`summoning-cost-help-${costField.key}`}>
                      {costField.help}
                    </small>
                  </label>
                )}
              </div>
            );
          })}
        </div>
      </section>
      <section className="panel form-section eggs-pets-form">
        <h3>
          <Egg size={19} />Eggs and pets
        </h3>
        <p className="form-section-subtitle">
          Enter one combined count for all your eggs and pets.
        </p>
        <label className="eggs-pets-input">
          <span>Total eggs/pets</span>
          <input
            aria-label="Total eggs/pets"
            type="number"
            inputMode="numeric"
            min="0"
            max={resourceMaximum("eggsPetsTotal")}
            step="1"
            value={values.eggsPetsTotal}
            onChange={(e) => update("eggsPetsTotal", e.target.value)}
          />
        </label>
      </section>
      <section className="panel form-section planning-bank-section">
        <h3><Swords size={19} />Levels and planned actions</h3>
        <p className="form-section-subtitle">Levels are kept for reference. Enter action counts directly; they are not inferred from levels or the combined eggs/pets total. Keep existing merges separate from newly summoned merges so the same action is counted once.</p>
        <div className="planning-bank-grid">
          {planningFields.map(({ key, label, help }) => <label key={key}>
            <span>{label}</span>
            <input aria-label={label} aria-describedby={`planning-help-${key}`} type="number" inputMode="numeric" min="0" max={planningMaximum(key)} step="1" value={planningValues[key]} onChange={(e) => setPlanningValues((old) => ({ ...old, [key]: e.target.value }))} />
            <small id={`planning-help-${key}`}>{help}</small>
          </label>)}
        </div>
      </section>
      <section className="panel form-section">
        <h3>
          <Clipboard size={19} />A note for the clan{" "}
          <span className="optional-badge">OPTIONAL</span>
        </h3>
        <textarea
          aria-label="Notes"
          maxLength={1000}
          placeholder="Anything your clan should know? Share your plans for this week…"
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
        <div className="character-count">{notes.length} / 1,000</div>
      </section>
      </fieldset>
      {!readOnly && <div className="save-bar">
        <span className={dirty ? "unsaved" : "saved"}>
          {dirty ? (
            <>
              <span />
              Unsaved changes
            </>
          ) : entry ? (
            <>
              <CheckCircle2 size={16} />
              All changes saved
            </>
          ) : (
            <>
              <CircleHelp size={16} />
              Ready to add your contribution
            </>
          )}
        </span>
        <button
          className="button primary"
          type="submit"
          disabled={saving}
        >
          {saving ? (
            <LoaderCircle size={17} className="spin" />
          ) : (
            <Check size={17} />
          )}
          {saving ? "Saving resources…" : "Save resources"}
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
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("active");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [sort, setSort] = useState("oldest");
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
  const filtered = members
    .filter((member) =>
      member.username.toLowerCase().includes(search.toLowerCase()),
    )
    .filter(
      (member) => filter === "all" || member.active === (filter === "active"),
    )
    .sort((a, b) => {
      if (sort === "alphabetical") return a.username.localeCompare(b.username, undefined, { sensitivity: "base", numeric: true });
      const difference = new Date(a.lastUpdatedAt ?? 0).getTime() - new Date(b.lastUpdatedAt ?? 0).getTime();
      return sort === "oldest" ? difference : -difference;
    });
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
          <label><span>Sort</span><select aria-label="Sort roster" value={sort} onChange={(event) => setSort(event.target.value)}><option value="oldest">Oldest update first</option><option value="newest">Newest update first</option><option value="alphabetical">A–Z</option></select></label>
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
                <th>Member</th>
                <th>Role</th>
                <th>Status</th>
                <th>Last resource update</th>
                <th>Joined</th>
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
                          {member.username}<MemberBadge member={member} />
                          {member.id === currentUser.id && (
                            <span className="you-badge">you</span>
                          )}
                        </strong>
                        <span>Discord · {member.discordId}</span>
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
                      {member.active ? "Active" : "Inactive"}
                    </span>
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
              <p>No members match this view.</p>
            </div>
          )}
        </div>
        <div className="table-footer">
          <span>{filtered.length} members</span>
          <span>At least one active admin is always required</span>
        </div>
      </section>
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
          <h2>Every week tells a story.</h2>
          <p>
            Weekly bank snapshots keep resource totals fixed, including the roster
            at capture time. Compare movements or revisit a saved dashboard.
          </p>
        </div>
        <span className="count-badge">{data.weeks.length} saved weeks</span>
      </section>
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
          Weeks begin Monday 00:00 UTC, which is Monday 10am AEST or 11am AEDT
          in Sydney. Historical views are read-only; live banks carry forward.
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
      <div className="stat-grid">
        {dashboardResources.map((item) => (
          <div className="skeleton skeleton-stat" key={item.key} />
        ))}
      </div>
    </div>
  );
}
