"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, CalendarDays, LoaderCircle } from "lucide-react";
import { RESOURCE_FIELDS, currentWeek, formatWeek, numberFormat, type ResourceKey } from "@/lib/resources";
import { RESOURCE_ICONS } from "./resource-icons";
import { utcDateTime } from "@/lib/war-calendar";
import { useLanguage } from "@/lib/i18n";
import type { BankHistoryResponse, BankHistorySnapshot } from "@/lib/types";

type Props = {
  admin: boolean;
  notify: (message: string, error?: boolean) => void;
  refresh: () => Promise<void>;
};
type SortKey = "name" | "value" | "previous" | "movement";

async function historyApi<T>(options?: RequestInit): Promise<T> {
  const response = await fetch("/api/history", { ...options, headers: { "Content-Type": "application/json", ...options?.headers }, cache: "no-store" });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Could not load weekly history.");
  return result as T;
}

export function BankHistory({ admin, notify, refresh }: Props) {
  const { t, language } = useLanguage();
  const [data, setData] = useState<BankHistoryResponse | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [view, setView] = useState("clan");
  const [resource, setResource] = useState<ResourceKey>("skillTickets");
  const [source, setSource] = useState("live");
  const [member, setMember] = useState("all");
  const [sort, setSort] = useState<{ key: SortKey; direction: "asc" | "desc" }>({ key: "name", direction: "desc" });
  const load = useCallback(async () => {
    try { setData(await historyApi<BankHistoryResponse>()); setError(""); }
    catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  async function capture() {
    setSaving(true);
    try {
      await historyApi({ method: "POST", body: "{}" });
      await load();
      await refresh();
      notify(t("This week is saved. Its members and totals are now fixed."));
    } catch (e) { notify((e as Error).message, true); }
    finally { setSaving(false); }
  }
  const snapshots = useMemo(() => [...(data?.snapshots ?? [])].sort((a, b) => b.week.localeCompare(a.week) || b.capturedAt.localeCompare(a.capturedAt)), [data]);
  const allMembers = useMemo(() => {
    const members = new Map(data?.current.members.map((item) => [item.id, item]));
    for (const snapshot of snapshots) for (const item of snapshot.members) if (!members.has(item.id)) members.set(item.id, item);
    return [...members.values()].sort((a, b) => a.username.localeCompare(b.username));
  }, [data, snapshots]);
  const changeSort = (key: SortKey) => setSort((old) => ({ key, direction: old.key === key ? old.direction === "asc" ? "desc" : "asc" : key === "name" && view === "member" ? "asc" : "desc" }));
  const sortOrder = (key: SortKey) => sort.key === key ? sort.direction === "asc" ? "ascending" as const : "descending" as const : "none" as const;
  const sortIcon = (key: SortKey) => sort.key !== key ? <ArrowUpDown size={12} aria-hidden="true" /> : sort.direction === "asc" ? <ArrowUp size={12} aria-hidden="true" /> : <ArrowDown size={12} aria-hidden="true" />;
  const snapshotKey = (snapshot: BankHistorySnapshot) => snapshot.id ?? snapshot.week;
  const selected = source === "live" ? data?.current : snapshots.find((item) => snapshotKey(item) === source);
  const selectedIndex = source === "live" ? -1 : snapshots.findIndex((item) => snapshotKey(item) === source);
  const previous = source === "live" ? snapshots[0] : snapshots[selectedIndex + 1];
  const selectedResourceLabel = RESOURCE_FIELDS.find((item) => item.key === resource)?.label;
  const rows = view === "clan"
    ? (data ? [
      { id: "live", name: t("Now (live)"), sortName: `${data.current.week}T23:59:59Z`, value: data.current.totals[resource], previous: snapshots[0]?.totals[resource] ?? null, week: data.current.week, snapshotId: undefined, capturedAt: null, automatic: false },
      ...snapshots.map((snapshot, index) => ({ id: snapshotKey(snapshot), name: t("Week of {date}", { date: formatWeek(snapshot.week) }), sortName: `${snapshot.week}T${snapshot.capturedAt}`,
        snapshotId: snapshot.id, value: snapshot.totals[resource], previous: snapshots[index + 1]?.totals[resource] ?? null, week: snapshot.week, capturedAt: snapshot.capturedAt, automatic: snapshot.automatic })),
    ] : [])
    : (selected?.members ?? []).filter((item) => member === "all" || item.id === member).map((item) => ({ id: item.id, name: item.username, sortName: item.username, value: selected?.entries.find((entry) => entry.memberId === item.id)?.resources[resource] ?? 0, previous: previous ? previous.entries.find((entry) => entry.memberId === item.id)?.resources[resource] ?? 0 : null, week: selected?.week ?? currentWeek(), snapshotId: undefined, capturedAt: null, automatic: false }));
  rows.sort((a, b) => {
    const value = (row: (typeof rows)[number]) => sort.key === "name" ? row.sortName : sort.key === "movement" ? row.previous === null ? Number.NEGATIVE_INFINITY : row.value - row.previous : sort.key === "previous" ? row.previous ?? Number.NEGATIVE_INFINITY : row.value;
    const av = value(a), bv = value(b);
    const difference = typeof av === "string" && typeof bv === "string" ? av.localeCompare(bv, undefined, { numeric: true, sensitivity: "base" }) : av === bv ? 0 : Number(av) < Number(bv) ? -1 : 1;
    return difference * (sort.direction === "asc" ? 1 : -1);
  });
  const selectedSnapshot = selected && "capturedAt" in selected ? selected as BankHistorySnapshot : null;
  return <section className="panel bank-history">
    <div className="table-section-heading">
      <div><h2>{t("Week by week")}</h2><p>{t("Saved automatically every Monday at 00:00 UTC.")}</p></div>
      {admin && <button className="button secondary" disabled={saving || !data} onClick={capture}>{saving ? <LoaderCircle size={15} className="spin" /> : <CalendarDays size={15} />}{t("Save this week now")}</button>}
    </div>
    <div className="history-controls">
      <label><span>{t("Compare")}</span><select aria-label={t("Compare")} value={view} onChange={(event) => { setView(event.target.value); setSort({ key: "name", direction: event.target.value === "member" ? "asc" : "desc" }); }}><option value="clan">{t("Clan totals")}</option><option value="member">{t("By member")}</option></select></label>
      <label><span>{t("Resource")}</span><select aria-label={t("Resource")} value={resource} onChange={(event) => setResource(event.target.value as ResourceKey)}>{RESOURCE_FIELDS.map((item) => <option key={item.key} value={item.key}>{t(item.label)}</option>)}</select></label>
      {view === "member" && <><label><span>{t("Week")}</span><select aria-label={t("Week")} value={source} onChange={(event) => setSource(event.target.value)}><option value="live">{t("Now (live)")}</option>{snapshots.map((snapshot) => <option key={snapshotKey(snapshot)} value={snapshotKey(snapshot)}>{t("Week of {date}", { date: formatWeek(snapshot.week) })} · {snapshot.automatic ? t("Automatic") : t("Manual")} {utcDateTime(snapshot.capturedAt, language)}</option>)}</select></label><label><span>{t("Member")}</span><select aria-label={t("Member")} value={member} onChange={(event) => setMember(event.target.value)}><option value="all">{t("All members")}</option>{allMembers.map((item) => <option key={item.id} value={item.id}>{item.username}</option>)}</select></label></>}
    </div>
    {error && <div className="error-banner" role="alert">{t(error)}<button onClick={load}>{t("Retry")}</button></div>}
    {!data && !error ? <div className="table-empty"><LoaderCircle size={20} className="spin" /><p>{t("Loading…")}</p></div> : <>
      <p className="history-context">{view === "member" ? <>{source === "live"
        ? previous ? t("Comparing now with the week of {previous}.", { previous: formatWeek(previous.week) }) : t("Comparing now with no earlier saved week.")
        : previous ? t("Comparing the week of {date} with the week of {previous}.", { date: formatWeek(selected?.week ?? currentWeek()), previous: formatWeek(previous.week) }) : t("Comparing the week of {date} with no earlier saved week.", { date: formatWeek(selected?.week ?? currentWeek()) })}
        {selectedSnapshot && <> {t("Saved {date}.", { date: utcDateTime(selectedSnapshot.capturedAt, language) })}</>}</> : t("Each change compares a week with the saved week before it. These are changes in what’s held, not points spent or earned.")}</p>
      <div className="table-scroll"><table className="resource-table history-table stack-table"><thead><tr>
        <th aria-sort={sortOrder("name")}><button className="column-sort" onClick={() => changeSort("name")}>{view === "clan" ? t("Week") : t("Member")}{sortIcon("name")}</button></th>
        <th aria-sort={sortOrder("value")}><button className="column-sort" onClick={() => changeSort("value")}>{(() => { const Picture = RESOURCE_ICONS[resource]; return <Picture size={18} />; })()}{selectedResourceLabel ? t(selectedResourceLabel) : ""}{sortIcon("value")}</button></th>
        <th aria-sort={sortOrder("previous")}><button className="column-sort" onClick={() => changeSort("previous")}>{t("Week before")}{sortIcon("previous")}</button></th>
        <th aria-sort={sortOrder("movement")}><button className="column-sort" onClick={() => changeSort("movement")}>{t("Difference")}{sortIcon("movement")}</button></th>
        {view === "clan" && <th>{t("Saved week")}</th>}
      </tr></thead><tbody>{rows.map((row) => {
        const movement = row.previous === null ? null : row.value - row.previous;
        return <tr key={row.id}><td className="stack-title"><span><strong>{row.name}</strong>{row.capturedAt && <small className="history-capture">{row.automatic ? t("Automatic") : t("Manual")} · {utcDateTime(row.capturedAt, language)}</small>}</span></td><td data-label={selectedResourceLabel ? t(selectedResourceLabel) : ""}>{numberFormat(row.value)}</td><td data-label={t("Week before")}>{row.previous === null ? "—" : numberFormat(row.previous)}</td><td data-label={t("Difference")} className={movement === null || movement === 0 ? "" : movement > 0 ? "movement-up" : "movement-down"}>{movement === null ? "—" : `${movement > 0 ? "+" : ""}${numberFormat(movement)}`}</td>{view === "clan" && <td className="stack-full"><Link className="text-link" href={row.id === "live" ? "/" : `/?week=${row.week}${row.snapshotId ? `&snapshot=${encodeURIComponent(row.snapshotId)}` : ""}`}>{t("View that week")}</Link></td>}</tr>;
      })}</tbody></table></div>
      {!snapshots.length && <p className="history-context">{t("No saved weeks yet. The first one is saved on Monday at 00:00 UTC.")}</p>}
      {view === "member" && !rows.length && <p className="table-empty">{t("No members match this view.")}</p>}
    </>}
    <div className="table-footer"><span>{t("Saved weeks keep the members and totals they had then.")}</span><span>{t("Saved automatically each Monday, or by a leader")}</span></div>
  </section>;
}
