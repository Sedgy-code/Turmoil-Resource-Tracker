"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, CalendarDays, LoaderCircle } from "lucide-react";
import { RESOURCE_FIELDS, currentWeek, formatWeek, numberFormat, type ResourceKey } from "@/lib/resources";
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
      notify("Weekly snapshot saved. Its roster and totals are now fixed.");
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
      { id: "live", name: "Current live bank", sortName: `${data.current.week}T23:59:59Z`, value: data.current.totals[resource], previous: snapshots[0]?.totals[resource] ?? null, week: data.current.week, snapshotId: undefined, capturedAt: null, automatic: false },
      ...snapshots.map((snapshot, index) => ({ id: snapshotKey(snapshot), name: `Week of ${formatWeek(snapshot.week)}`, sortName: `${snapshot.week}T${snapshot.capturedAt}`,
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
      <div><h2>Weekly bank history</h2><p>Automatic capture at Monday 00:00 UTC.</p></div>
      {admin && <button className="button secondary" disabled={saving || !data} onClick={capture}>{saving ? <LoaderCircle size={15} className="spin" /> : <CalendarDays size={15} />}Save snapshot now</button>}
    </div>
    <div className="history-controls">
      <label><span>Compare</span><select aria-label="History view" value={view} onChange={(event) => { setView(event.target.value); setSort({ key: "name", direction: event.target.value === "member" ? "asc" : "desc" }); }}><option value="clan">Clan totals</option><option value="member">By member</option></select></label>
      <label><span>Resource</span><select aria-label="History resource" value={resource} onChange={(event) => setResource(event.target.value as ResourceKey)}>{RESOURCE_FIELDS.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label>
      {view === "member" && <><label><span>Bank</span><select aria-label="History bank" value={source} onChange={(event) => setSource(event.target.value)}><option value="live">Current live bank</option>{snapshots.map((snapshot) => <option key={snapshotKey(snapshot)} value={snapshotKey(snapshot)}>Week of {formatWeek(snapshot.week)} · {snapshot.automatic ? "Automatic" : "Manual"} {new Date(snapshot.capturedAt).toLocaleString("en-AU", { timeZone: "Australia/Sydney", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</option>)}</select></label><label><span>Member</span><select aria-label="History member" value={member} onChange={(event) => setMember(event.target.value)}><option value="all">All members</option>{allMembers.map((item) => <option key={item.id} value={item.id}>{item.username}</option>)}</select></label></>}
    </div>
    {error && <div className="error-banner" role="alert">{error}<button onClick={load}>Retry history</button></div>}
    {!data && !error ? <div className="table-empty"><LoaderCircle size={20} className="spin" /><p>Loading weekly history…</p></div> : <>
      <p className="history-context">{view === "member" ? <>Comparing {source === "live" ? "the live bank" : `week of ${formatWeek(selected?.week ?? currentWeek())}`} with {previous ? `week of ${formatWeek(previous.week)}` : "no earlier saved snapshot"}.{selectedSnapshot && <> Captured {new Date(selectedSnapshot.capturedAt).toLocaleString("en-AU", { timeZone: "Australia/Sydney" })} Sydney time.</>}</> : "Each movement compares a bank with the next earlier saved snapshot. These are inventory changes, not points spent or earned."}</p>
      <div className="table-scroll"><table className="resource-table history-table"><thead><tr>
        <th aria-sort={sortOrder("name")}><button className="column-sort" onClick={() => changeSort("name")}>{view === "clan" ? "Week" : "Member"}{sortIcon("name")}</button></th>
        <th aria-sort={sortOrder("value")}><button className="column-sort" onClick={() => changeSort("value")}>{selectedResourceLabel}{sortIcon("value")}</button></th>
        <th aria-sort={sortOrder("previous")}><button className="column-sort" onClick={() => changeSort("previous")}>Previous snapshot{sortIcon("previous")}</button></th>
        <th aria-sort={sortOrder("movement")}><button className="column-sort" onClick={() => changeSort("movement")}>Movement{sortIcon("movement")}</button></th>
        {view === "clan" && <th>Saved dashboard</th>}
      </tr></thead><tbody>{rows.map((row) => {
        const movement = row.previous === null ? null : row.value - row.previous;
        return <tr key={row.id}><td><strong>{row.name}</strong>{row.capturedAt && <small className="history-capture">{row.automatic ? "Automatic" : "Manual"} · {new Date(row.capturedAt).toLocaleString("en-AU", { timeZone: "Australia/Sydney", dateStyle: "medium", timeStyle: "short" })} Sydney</small>}</td><td>{numberFormat(row.value)}</td><td>{row.previous === null ? "—" : numberFormat(row.previous)}</td><td className={movement === null || movement === 0 ? "" : movement > 0 ? "movement-up" : "movement-down"}>{movement === null ? "—" : `${movement > 0 ? "+" : ""}${numberFormat(movement)}`}</td>{view === "clan" && <td><Link className="text-link" href={row.id === "live" ? "/" : `/?week=${row.week}${row.snapshotId ? `&snapshot=${encodeURIComponent(row.snapshotId)}` : ""}`}>View dashboard</Link></td>}</tr>;
      })}</tbody></table></div>
      {!snapshots.length && <p className="history-context">No fixed snapshots yet. Your current bank is available above; the first snapshot will establish a comparison.</p>}
      {view === "member" && !rows.length && <p className="table-empty">No members match this historical roster.</p>}
    </>}
    <div className="table-footer"><span>Saved snapshots keep their original members and totals.</span><span>Automatic weekly captures + manual snapshots</span></div>
  </section>;
}
