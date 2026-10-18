"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Ban, CalendarDays, History, LoaderCircle, Sun, X } from "lucide-react";
import type { Member, MemberHistoryEvent, MemberHistoryResponse } from "@/lib/types";
import { MemberAvatar, MemberName } from "./member-identity";
import { useLanguage } from "@/lib/i18n";
import "./member-history.css";

const ICONS: Partial<Record<MemberHistoryEvent["kind"], string>> = {
  joined: "👋", left: "🚪", returned: "↩️", role: "🛡️", strike: "⚠️", "strike-removed": "✅", holiday: "🏖️", "holiday-ended": "🏠",
  war: "⚔️", vials: "🧪", snipe: "🎯", saved: "💾",
};

async function send<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, body === undefined ? { cache: "no-store" } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "Something went wrong. Please try again.");
  return result as T;
}

/** Side panel for one member: strikes, holiday and everything they've done. Admins only. */
export function MemberHistoryPanel({ member, onClose, onChanged, notify }: {
  member: Member;
  onClose: () => void;
  onChanged: () => void;
  notify: (message: string, error?: boolean) => void;
}) {
  const { t, language } = useLanguage();
  const [data, setData] = useState<MemberHistoryResponse | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [until, setUntil] = useState("");
  const [filter, setFilter] = useState<"all" | "leadership" | "activity">("all");
  const load = useCallback(async () => {
    try { setData(await send<MemberHistoryResponse>(`/api/members/${member.id}/history`)); setError(""); }
    catch (e) { setError((e as Error).message); }
  }, [member.id]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);
  async function act(body: unknown, done: string) {
    setBusy(true);
    try {
      await send(`/api/members/${member.id}/leadership`, body);
      notify(t(done));
      await load();
      onChanged();
    } catch (e) { notify(t((e as Error).message), true); }
    finally { setBusy(false); }
  }
  function addStrike(event: FormEvent) {
    event.preventDefault();
    if (!reason.trim()) return;
    void act({ action: "strike", reason: reason.trim() }, t("Strike added.")).then(() => setReason(""));
  }
  function setHoliday(event: FormEvent) {
    event.preventDefault();
    if (until) void act({ action: "holiday", until }, t("Holiday saved."));
  }
  const shown = (data?.events ?? []).filter((event) => filter === "all" ? true
    : filter === "leadership" ? ["strike", "strike-removed", "holiday", "holiday-ended", "role", "joined", "left", "returned"].includes(event.kind)
      : ["war", "vials", "snipe", "saved"].includes(event.kind));
  const current = data?.member ?? member;
  const today = new Date().toISOString().slice(0, 10);
  const day = (iso: string) => new Date(iso).toLocaleDateString(language, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  return <div className="history-overlay" role="dialog" aria-modal="true" aria-label={t("{name}’s history", { name: member.username })}>
    <button className="history-scrim" aria-label={t("Close")} onClick={onClose} />
    <aside className="history-panel">
      <header>
        <div className="table-member"><MemberAvatar member={current} /><div><strong><MemberName member={current} /></strong><span>{current.role === "ADMIN" ? t("Admin") : t("Member")} · {t("joined {date}", { date: day(current.joinedAt) })}</span></div></div>
        <button className="icon-button" aria-label={t("Close")} onClick={onClose}><X size={18} /></button>
      </header>
      {error && <div className="error-banner" role="alert">{t(error)}<button onClick={() => void load()}>{t("Retry")}</button></div>}
      <section className="history-block">
        <h3><Ban size={15} />{t("Strikes")} <b className={(current.strikes ?? 0) > 0 ? "strike-count has" : "strike-count"}>{current.strikes ?? 0}</b></h3>
        {data?.strikes.map((strike) => <div key={strike.id} className="history-strike">
          <div><strong>{strike.reason}</strong><small>{day(strike.createdAt)} · {strike.createdBy}</small></div>
          <button className="button subtle small-button" disabled={busy} onClick={() => window.confirm(t("Remove this strike?")) && void act({ action: "remove-strike", strikeId: strike.id }, t("Strike removed."))}>{t("Remove")}</button>
        </div>)}
        <form className="history-form" onSubmit={addStrike}>
          <input aria-label={t("Reason for the strike")} placeholder={t("Reason, e.g. missed war days 1–5")} maxLength={300} value={reason} onChange={(event) => setReason(event.target.value)} />
          <button className="button secondary small-button" disabled={busy || !reason.trim()}>{busy ? <LoaderCircle size={13} className="spin" /> : <Ban size={13} />}{t("Add strike")}</button>
        </form>
      </section>
      <section className="history-block">
        <h3><Sun size={15} />{t("Holiday")}</h3>
        {current.holidayUntil
          ? <div className="history-strike"><div><strong>{t("On holiday until {date}", { date: current.holidayUntil })}</strong><small>{t("No reminders, and the ranking shows 🏖️.")}</small></div><button className="button subtle small-button" disabled={busy} onClick={() => void act({ action: "holiday", until: null }, t("Holiday ended."))}>{t("End now")}</button></div>
          : <p className="history-hint">{t("Not on holiday. Members on holiday skip the Monday reminder.")}</p>}
        <form className="history-form" onSubmit={setHoliday}>
          <label className="history-date"><CalendarDays size={14} /><input type="date" aria-label={t("Away until")} min={today} value={until} onChange={(event) => setUntil(event.target.value)} /></label>
          <button className="button secondary small-button" disabled={busy || !until}>{current.holidayUntil ? t("Change date") : t("Set holiday")}</button>
        </form>
      </section>
      <section className="history-block history-timeline">
        <h3><History size={15} />{t("History")}</h3>
        <div className="table-tabs">{(["all", "leadership", "activity"] as const).map((item) => <button key={item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>{item === "all" ? t("Everything") : item === "leadership" ? t("Leadership") : t("Activity")}</button>)}</div>
        {!data ? <LoaderCircle size={20} className="spin" /> : shown.length === 0 ? <p className="history-hint">{t("Nothing yet.")}</p> : <ol>
          {shown.map((event, index) => <li key={`${event.at}-${index}`} className={`history-${event.kind}`}>
            <span className="history-icon" aria-hidden="true">{ICONS[event.kind] ?? "•"}</span>
            <div><strong>{event.template ? t(event.template, event.values) : event.text}</strong><small>{day(event.at)}{event.by ? ` · ${t("by {name}", { name: event.by })}` : ""}</small></div>
          </li>)}
        </ol>}
      </section>
    </aside>
  </div>;
}
