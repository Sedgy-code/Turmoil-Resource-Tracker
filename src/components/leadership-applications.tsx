"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Check, ClipboardCopy, Inbox, LoaderCircle, Settings2, X } from "lucide-react";
import type { Application, ApplicationSettings, ApplicationsResponse } from "@/lib/types";
import { useSortable } from "./sortable";
import "./member-history.css";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "Something went wrong. Please try again.");
  return result as T;
}

function useApplications() {
  const [data, setData] = useState<ApplicationsResponse | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try { setData(await request<ApplicationsResponse>("/api/applications")); setError(""); }
    catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  return { data, error, load };
}

type Column = "date" | "name" | "power" | "stage" | "status";

/** Leadership → Applications: everyone who applied on the public Apply page. */
export function ApplicationsManager({ notify }: { notify: (message: string, error?: boolean) => void }) {
  const { data, error, load } = useApplications();
  const [filter, setFilter] = useState<"pending" | "all">("pending");
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const rows = (data?.applications ?? []).filter((application) => filter === "all" || application.status === "pending");
  const { sorted, header } = useSortable<Application, Column>(rows, {
    date: (row) => new Date(row.createdAt).getTime(),
    name: (row) => row.gameName,
    power: (row) => row.power,
    stage: (row) => row.stage,
    status: (row) => row.status,
  }, { key: "date", direction: "desc" });
  async function decide(application: Application, status: "accepted" | "declined") {
    setBusy(application.id);
    try {
      await request(`/api/applications/${application.id}`, { method: "PATCH", body: JSON.stringify({ status }) });
      notify(status === "accepted" ? `${application.gameName} accepted. Invite them in game and on Discord.` : `${application.gameName} declined.`);
      await load();
    } catch (e) { notify((e as Error).message, true); await load(); }
    finally { setBusy(null); }
  }
  const pending = (data?.applications ?? []).filter((application) => application.status === "pending").length;
  return <div className="hoard-page">
    <section className="panel hoard-intro">
      <div>
        <h2>Applications</h2>
        <p>People apply on the public page below. Each one is also posted in Discord’s private #📝-applications channel, where you can press Accept or Decline too.</p>
        <ShareLink />
      </div>
      {data && !data.settings.open && <p className="war-message">Applications are closed. Open them again in Settings.</p>}
    </section>
    <section className="panel">
      <div className="table-tabs">
        <button className={filter === "pending" ? "active" : ""} onClick={() => setFilter("pending")}>Waiting ({pending})</button>
        <button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>All</button>
      </div>
      {error && <div className="error-banner" role="alert">{error}<button onClick={() => void load()}>Retry</button></div>}
      {!data ? <div className="table-empty"><LoaderCircle size={20} className="spin" /></div> : !sorted.length ? <div className="table-empty"><Inbox size={24} /><p>{filter === "pending" ? "No applications waiting." : "No applications yet."}</p></div> :
        <div className="table-scroll"><table className="resource-table">
          <thead><tr>{header("date", "Sent")}{header("name", "In-game name")}<th>Discord</th>{header("power", "Power")}{header("stage", "Stage")}<th>Time zone</th><th>War days</th>{header("status", "Status")}<th>Actions</th></tr></thead>
          <tbody>{sorted.map((application) => <Fragment key={application.id}>
            <tr>
              <td>{new Date(application.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</td>
              <td><button className="link-button" onClick={() => setOpen(open === application.id ? null : application.id)}><strong>{application.gameName}</strong></button></td>
              <td>{application.discordName}</td>
              <td>{application.power || "—"}</td>
              <td>{application.stage || "—"}</td>
              <td>{application.timezone || "—"}</td>
              <td>{application.warDays || "—"}</td>
              <td><span className={`hoard-level hoard-level-${application.status === "accepted" ? "saver" : application.status === "declined" ? "high" : "watch"}`}>{application.status === "pending" ? "Waiting" : application.status === "accepted" ? "Accepted" : "Declined"}</span>{application.decidedBy && <small className="rank-sub">by {application.decidedBy}</small>}</td>
              <td>{application.status === "pending" ? <div className="member-actions">
                <button className="button secondary small-button" disabled={busy !== null} onClick={() => void decide(application, "accepted")}>{busy === application.id ? <LoaderCircle size={13} className="spin" /> : <Check size={13} />}Accept</button>
                <button className="button subtle small-button danger-text" disabled={busy !== null} onClick={() => window.confirm(`Decline ${application.gameName}?`) && void decide(application, "declined")}><X size={13} />Decline</button>
              </div> : "—"}</td>
            </tr>
            {open === application.id && <tr className="application-about"><td colSpan={9}><strong>Server:</strong> {application.server || "—"} · <strong>Languages:</strong> {application.languages || "—"}<br />{application.about || "No message."}</td></tr>}
          </Fragment>)}</tbody>
        </table></div>}
    </section>
  </div>;
}

function ShareLink() {
  const [copied, setCopied] = useState(false);
  const link = typeof window === "undefined" ? "/apply" : `${window.location.origin}/apply`;
  return <p className="apply-share">Share this link: <Link href="/apply" target="_blank">{link}</Link>
    <button className="button subtle small-button" onClick={() => { void navigator.clipboard?.writeText(link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}><ClipboardCopy size={13} />{copied ? "Copied" : "Copy"}</button></p>;
}

/** Leadership → Settings. */
export function LeadershipSettings({ notify }: { notify: (message: string, error?: boolean) => void }) {
  const { data, error, load } = useApplications();
  const [channel, setChannel] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (data) setChannel(data.settings.channelId); }, [data]);
  async function save(patch: Partial<ApplicationSettings>, done: string) {
    setSaving(true);
    try { await request("/api/applications/settings", { method: "PATCH", body: JSON.stringify(patch) }); notify(done); await load(); }
    catch (e) { notify((e as Error).message, true); }
    finally { setSaving(false); }
  }
  return <div className="hoard-page">
    {error && <div className="error-banner" role="alert">{error}<button onClick={() => void load()}>Retry</button></div>}
    <section className="panel settings-block">
      <h2><Settings2 size={16} />Applications</h2>
      {!data ? <LoaderCircle size={20} className="spin" /> : <>
        <label className="rank-toggle"><input type="checkbox" checked={data.settings.open} disabled={saving} onChange={(event) => void save({ open: event.target.checked }, event.target.checked ? "Applications are open." : "Applications are closed.")} />Taking new applications</label>
        <ShareLink />
        <form className="history-form" onSubmit={(event) => { event.preventDefault(); void save({ channelId: channel.trim() }, "Channel saved."); }}>
          <label className="settings-field"><span>Discord channel ID for new applications</span><input value={channel} onChange={(event) => setChannel(event.target.value)} inputMode="numeric" /></label>
          <button className="button secondary small-button" disabled={saving || channel.trim() === data.settings.channelId}>Save</button>
        </form>
        <p className="history-hint">The bot needs to be able to see and post in that channel.</p>
      </>}
    </section>
    <section className="panel settings-block">
      <h2><Settings2 size={16} />Other settings</h2>
      <ul className="settings-links">
        <li><Link href="/war-points">War point rates</Link> — on the Points Calculator page (Edit rates).</li>
        <li><Link href="/hoarding-watch">Saver vs hoarder rules</Link> — on the Hoarding page.</li>
        <li><Link href="/members">Clan capacity, strikes and holidays</Link> — on the Members page.</li>
      </ul>
    </section>
  </div>;
}
