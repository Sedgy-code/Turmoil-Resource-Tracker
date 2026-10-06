"use client";

import Link from "next/link";
import { ClanBrand } from "./clan-brand";
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
  Copy,
  Egg,
  Flame,
  FlaskConical,
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
  EMPTY_SUMMONING_COSTS,
  RESOURCE_FIELDS,
  currentWeek,
  formatWeek,
  numberFormat,
  resourceMaximum,
  shiftWeek,
  type ResourceKey,
  type ResourceValues,
  type SummoningCosts,
} from "@/lib/resources";
import type {
  DashboardResponse,
  EntryResponse,
  Member,
  MembersResponse,
  SessionResponse,
} from "@/lib/types";

type View = "dashboard" | "resources" | "members" | "weeks";
type Icon = ComponentType<{
  size?: number;
  className?: string;
  strokeWidth?: number;
}>;
const viewNames = {
  dashboard: "Dashboard",
  resources: "My Resources",
  members: "Manage Members",
  weeks: "Weeks",
};
const navigation: { view: View; href: string; icon: Icon }[] = [
  { view: "dashboard", href: "/", icon: LayoutDashboard },
  { view: "resources", href: "/resources", icon: Backpack },
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
  { key: "potions", icon: FlaskConical, label: "Potions", color: "green" },
];

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
    cache: "no-store",
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error || "Something went wrong. Please try again.");
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
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [sessionError, setSessionError] = useState("");
  const [week, setWeek] = useState(currentWeek());
  const [data, setData] = useState<DashboardResponse | null>(null);
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
  useEffect(() => {
    api<SessionResponse>("/api/session")
      .then(setSession)
      .catch((e) => setSessionError(e.message));
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);
  const refresh = useCallback(async () => {
    if (!session?.user) return;
    const generation = ++requestGeneration.current;
    setLoading(true);
    setError("");
    try {
      const result = await api<DashboardResponse>(
        `/api/dashboard?week=${week}`,
      );
      if (generation === requestGeneration.current) setData(result);
    } catch (e) {
      if (generation === requestGeneration.current)
        setError((e as Error).message);
    } finally {
      if (generation === requestGeneration.current) setLoading(false);
    }
  }, [session, week]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (view !== "dashboard" || !session?.user) return;
    const sync = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const interval = setInterval(sync, 30000);
    window.addEventListener("focus", sync);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", sync);
    };
  }, [view, session, refresh]);
  function selectWeek(value: string) {
    const next = new URLSearchParams(params.toString());
    next.set("week", currentWeek(new Date(`${value}T00:00:00Z`)));
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
  const ownEntry = data?.entries.find((entry) => entry.memberId === user.id);
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
              <strong>{user.username}</strong>
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
                  {!data?.entries.length && <p>No updates this week yet.</p>}
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
                      : "THE CLAN ARCHIVE"}
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
                      : "Past preparations. Future victories. Your weekly resource history."}
              </p>
            </div>
            {view !== "members" && (
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
          ) : (!data || data.week !== week) && loading ? (
            <DashboardSkeleton />
          ) : data && data.week === week && view === "dashboard" ? (
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
                    href={`/resources?week=${week}`}
                    className="button primary"
                  >
                    {ownEntry ? "Update my resources" : "Add my resources"}
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
                    <span>have shared their resources this week</span>
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
                    This week’s arsenal{" "}
                    <span className="live-badge">
                      <i />
                      LIVE TOTALS
                    </span>
                  </h2>
                  <p>Combined resources from all active Turmoil members.</p>
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
              <div className="stat-grid">
                {essentials.map(({ key, label, icon: StatIcon, color }) => {
                  const summons =
                    key === "skillTickets"
                      ? {
                          label: "Total skill summons",
                          total: data.summons?.skills ?? 0,
                          missing: data.summons?.missingSkillCosts ?? 0,
                        }
                      : key === "mountKeys"
                        ? {
                            label: "Total mount summons",
                            total: data.summons?.mounts ?? 0,
                            missing: data.summons?.missingMountCosts ?? 0,
                          }
                        : null;
                  const warPoints =
                    key === "skillTickets"
                      ? {
                          total: (data.summons?.skills ?? 0) * 225,
                          note: "225 points per skill summon.",
                        }
                      : key === "mountsToMerge"
                        ? {
                            total: data.totals.mountsToMerge * 1_080,
                            note: "1,080 points per mount to merge.",
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
                            {new Intl.NumberFormat("en-US", {
                              minimumFractionDigits: 0,
                              maximumFractionDigits: 0,
                            }).format(summons.total)}
                          </strong>
                          <span className="summon-note">
                            Clan total rounded to a whole number.
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
                            {numberFormat(warPoints.total)}
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
              <EggsPetsCard total={data.totals.eggsPetsTotal} />
              <MemberResources
                data={data}
                week={week}
                admin={user.role === "ADMIN"}
              />
            </>
          ) : data && data.week === week && view === "resources" ? (
            <ResourceForm
              data={data}
              week={week}
              memberId={params.get("member")}
              notify={notify}
              refresh={refresh}
            />
          ) : data && view === "members" ? (
            <MembersManager currentUser={user} notify={notify} />
          ) : data && data.week === week && view === "weeks" ? (
            <Weeks data={data} week={week} selectWeek={selectWeek} />
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
              Every week begins Monday at 00:00 UTC. Add your current Forge
              Masters resources in My Resources and save your entry. Your
              contribution appears in the clan totals immediately.
            </p>
            <div className="guide-row">
              <Backpack size={20} />
              <div>
                <strong>Update your arsenal</strong>
                <p>
                  All amounts are whole numbers. You can copy your previous week
                  to get started faster.
                </p>
              </div>
            </div>
            <div className="guide-row">
              <CalendarDays size={20} />
              <div>
                <strong>Browse any week</strong>
                <p>
                  Use the date picker or Weeks archive to see past entries. Each
                  week is saved separately.
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
            Sign in to track resources and prepare together.
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
    <article className="panel eggs-pets-card">
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
}: {
  data: DashboardResponse;
  week: string;
  admin: boolean;
}) {
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("all");
  const members = data.members
    .filter((member) =>
      member.username.toLowerCase().includes(search.toLowerCase()),
    )
    .filter(
      (member) =>
        tab === "all" ||
        (tab === "submitted"
          ? data.entries.some((entry) => entry.memberId === member.id)
          : !data.entries.some((entry) => entry.memberId === member.id)),
    );
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
              <th className="sticky-member">Member</th>
              {RESOURCE_FIELDS.map(({ key, label }) => {
                const FieldIcon =
                  key === "eggsPetsTotal"
                    ? Egg
                    : (essentials.find((field) => field.key === key)?.icon ??
                      Backpack);
                return (
                  <th key={key}>
                    <FieldIcon size={14} />
                    {label}
                  </th>
                );
              })}
              <th>Last updated</th>
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
                          {member.username}
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
                        <span>{ago(entry.updatedAt)}</span>
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
                        href={`/resources?week=${week}&member=${member.id}`}
                      >
                        Edit
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
  notify,
  refresh,
}: {
  data: DashboardResponse;
  week: string;
  memberId: string | null;
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
  const [copying, setCopying] = useState(false);
  const [formError, setFormError] = useState("");
  const dirty =
    resourceKeys.some((key) => values[key] !== String(savedResources[key])) ||
    costValues.fiveSkills !== String(savedCosts.fiveSkills) ||
    costValues.mount !== String(savedCosts.mount) ||
    notes !== (entry?.notes ?? "");
  useEffect(() => {
    setValues(draftResources(entry?.resources ?? EMPTY_RESOURCES));
    const costs = entry?.summoningCosts ?? EMPTY_SUMMONING_COSTS;
    setCostValues({
      fiveSkills: String(costs.fiveSkills),
      mount: String(costs.mount),
    });
    setNotes(entry?.notes ?? "");
    setFormError("");
  }, [selected.id, week, entry]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  async function save(event: FormEvent) {
    event.preventDefault();
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
      setFormError("Enter both summoning costs. Use 0 if the cost is unknown.");
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
      Object.values(summoningCosts).some(
        (value) =>
          !Number.isInteger(value) || value < 0 || value > 1_000_000_000,
      )
    ) {
      setFormError("Enter whole numbers between 0 and 1,000,000,000.");
      return;
    }
    setSaving(true);
    setFormError("");
    try {
      await api<EntryResponse>("/api/resources", {
        method: "PUT",
        body: JSON.stringify({
          week,
          memberId: selected.id,
          resources,
          summoningCosts,
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
  async function copyPrevious() {
    if (
      (dirty || entry) &&
      !window.confirm(
        "Replace this form with your previous week’s resources and summoning costs? This will also save the copied entry for this week.",
      )
    )
      return;
    setCopying(true);
    setFormError("");
    try {
      await api<EntryResponse>("/api/resources/copy", {
        method: "POST",
        body: JSON.stringify({ week, memberId: selected.id }),
      });
      await refresh();
      notify(
        "Previous week copied and saved. You can adjust your resources below.",
      );
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setCopying(false);
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
              : "No resources submitted for this week yet."}
          </p>
        </div>
        {data.currentUser.role === "ADMIN" && (
          <label className="member-select">
            <span>Editing member</span>
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
                router.push(`/resources?week=${week}&member=${e.target.value}`);
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
          Your resources are shared with the clan. Enter your current inventory
          for the week of {formatWeek(week)}.
        </span>
      </div>
      <div className="section-heading">
        <div>
          <h2>Your weekly inventory</h2>
          <p>Whole numbers only. Leave anything you don’t have at zero.</p>
        </div>
        <button
          className="button secondary"
          type="button"
          disabled={copying || saving}
          onClick={copyPrevious}
        >
          {copying ? (
            <LoaderCircle size={15} className="spin" />
          ) : (
            <Copy size={15} />
          )}
          Copy previous week
        </button>
      </div>
      {formError && (
        <div className="error-banner" role="alert">
          {formError}
        </div>
      )}
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
                  }
                : key === "mountKeys"
                  ? {
                      key: "mount" as const,
                      label: "Cost per mount summon",
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
                      inputMode="numeric"
                      min="0"
                      max="1000000000"
                      step="1"
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
                      Required whole number. Enter 0 if unknown.
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
      <div className="save-bar">
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
          disabled={saving || copying}
        >
          {saving ? (
            <LoaderCircle size={17} className="spin" />
          ) : (
            <Check size={17} />
          )}
          {saving ? "Saving resources…" : "Save resources"}
        </button>
      </div>
    </form>
  );
}

function MembersManager({
  currentUser,
  notify,
}: {
  currentUser: Member;
  notify: (message: string, error?: boolean) => void;
}) {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("active");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const result = await api<MembersResponse>("/api/members");
      setMembers(result.members);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
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
    );
  return (
    <>
      <div className="management-stats">
        <article className="panel">
          <Users size={21} />
          <strong>{members.filter((m) => m.active).length}</strong>
          <span>Active members</span>
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
          <strong>{members.filter((m) => !m.active).length}</strong>
          <span>Inactive members</span>
        </article>
      </div>
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
                          {member.username}
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
                    {ago(member.lastUpdatedAt)}
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
}: {
  data: DashboardResponse;
  week: string;
  selectWeek: (value: string) => void;
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
            Your clan’s resource entries are saved by week. Revisit an old
            inventory or start preparing for a new week with the date selector.
          </p>
        </div>
        <span className="count-badge">{data.weeks.length} saved weeks</span>
      </section>
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
          Weeks run Monday through Sunday in UTC. Changing weeks never
          overwrites another week’s entry.
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
        {essentials.map((item) => (
          <div className="skeleton skeleton-stat" key={item.key} />
        ))}
      </div>
      <div className="skeleton skeleton-eggs-pets" />
    </div>
  );
}
