"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { LoaderCircle, Pencil, Plus, Trash2, Trophy } from "lucide-react";
import { formatWeek, numberFormat } from "@/lib/resources";
import { useT } from "@/lib/i18n";
import type { Member, WarResult, WarResultsResponse } from "@/lib/types";
import { MemberAvatar, MemberName } from "./member-identity";
import { RankBadge } from "./contribution-cards";
import { VialIcon } from "./resource-icons";
import { useRecognition } from "./recognition";
import { VialDaily } from "./vial-daily";
import { useSortable } from "./sortable";
import { RecordEditor, request, TEXT, type RecordKind } from "./record-editor";
import { WarDaily } from "./war-daily";
import "./war-results.css";

export type { RecordKind };
const compact = (value: number) => value >= 1e6 ? `${numberFormat(Math.round(value / 1e5) / 10)}M` : value >= 1e4 ? `${numberFormat(Math.round(value / 100) / 10)}K` : numberFormat(value);

function useWarResults(kind: RecordKind) {
  const [results, setResults] = useState<WarResult[] | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try { setResults((await request<WarResultsResponse>(`/api/war-results?kind=${kind}`)).results); setError(""); }
    catch (e) { setError(e instanceof Error ? e.message : "Please try again."); }
  }, [kind]);
  useEffect(() => { void load(); }, [load]);
  return { results, error, load };
}

function WarPlayersTable({ kind, result, byId }: { kind: RecordKind; result: WarResult; byId: Map<string, Member> }) {
  const t = useT();
  const ranked = result.points.map((point, rank) => ({ ...point, rank }));
  const name = (point: (typeof ranked)[number]) => (point.memberId ? byId.get(point.memberId)?.username : undefined) ?? point.gameName;
  const { sorted, header } = useSortable(ranked, {
    rank: (point) => -point.rank,
    member: name,
    points: (point) => point.points,
  }, { key: "points", direction: "desc" });
  return <div className={`table-scroll${kind === "vials" ? " tone-teal" : ""}`}><table className="resource-table war-table">
    <thead><tr>{header("rank", "#")}{header("member", t("Member"))}{header("points", t(TEXT[kind].points), { icon: kind === "vials" ? <VialIcon size={20} /> : <Trophy size={16} aria-hidden="true" /> })}</tr></thead>
    <tbody>{sorted.map((point) => {
      const member = point.memberId ? byId.get(point.memberId) : undefined;
      return <tr key={point.position}>
        <td><RankBadge rank={point.rank + 1} /></td>
        <td>{member
          ? <div className="table-member"><MemberAvatar member={member} small /><strong><MemberName member={member} /></strong></div>
          : <span className="war-guest">{point.gameName}</span>}</td>
        <td className="war-points">{numberFormat(point.points)}</td>
      </tr>;
    })}</tbody>
  </table></div>;
}

export function WarResults({ kind = "war", members, admin, notify }: { kind?: RecordKind; members: Member[]; admin: boolean; notify: (message: string, error?: boolean) => void }) {
  const t = useT();
  const words = TEXT[kind];
  const { results, error, load } = useWarResults(kind);
  const { reload: reloadRecognition } = useRecognition();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const refresh = () => { void load(); void reloadRecognition(); };
  const byId = new Map(members.map((member) => [member.id, member]));
  const chart = [...(results ?? [])].filter((result) => result.clanTotal !== null).slice(0, 12).reverse();
  const highest = Math.max(1, ...chart.map((result) => result.clanTotal ?? 0));
  async function remove(result: WarResult) {
    if (!window.confirm(t(words.confirmDelete))) return;
    try {
      await request(`/api/war-results/${result.id}`, { method: "DELETE" });
      notify(t(words.deleted));
      refresh();
    } catch (e) {
      const text = e instanceof Error ? e.message : "Please try again.";
      notify(t(text), true);
    }
  }
  return <div className="war-page">
    {admin && (adding
      ? <RecordEditor kind={kind} members={members} notify={notify} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); refresh(); }} />
      : <button className="button primary war-add-open" onClick={() => setAdding(true)}><Plus size={16} />{t(words.add)}</button>)}
    {chart.length > 1 && <section className="panel war-chart">
      <h2>{t(words.chart)}</h2>
      <div className="war-bars" role="list">{chart.map((result) => <div key={result.id} role="listitem" className="war-bar" title={`${result.label || formatWeek(result.week)}: ${numberFormat(result.clanTotal ?? 0)}`}>
        <span className="war-bar-value">{compact(result.clanTotal ?? 0)}</span>
        <i style={{ height: `${Math.max(4, ((result.clanTotal ?? 0) / highest) * 100)}%` }} />
        <span className="war-bar-label">{formatWeek(result.week)}</span>
      </div>)}</div>
    </section>}
    {kind === "vials" && results && <VialDaily results={results} byId={byId} />}
    {kind === "war" && <WarDaily members={members} admin={admin} notify={notify} />}
    {error && <div className="error-banner" role="alert">{t(error)}<button onClick={() => void load()}>{t("Retry")}</button></div>}
    {!results ? <section className="panel war-empty"><LoaderCircle size={22} className="spin" /></section>
      : !results.length ? <section className="panel war-empty"><Trophy size={30} /><p>{t(words.empty)}</p></section>
        : results.map((result, index) => {
          if (admin && editing === result.id) return <RecordEditor key={result.id} kind={kind} members={members} existing={result} notify={notify}
            onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); }} />;
          const previous = results.slice(index + 1).find((item) => item.clanTotal !== null);
          const change = result.clanTotal !== null && previous?.clanTotal != null ? result.clanTotal - previous.clanTotal : null;
          return <article className="panel war-card" key={result.id}>
            <header>
              <div><h2>{result.label || t("Week of {date}", { date: formatWeek(result.week) })}</h2>{result.label && <p>{t("Week of {date}", { date: formatWeek(result.week) })}</p>}</div>
              <div className="war-card-total"><span>{t(words.total)}</span><strong>{result.clanTotal === null ? "—" : numberFormat(result.clanTotal)}</strong>
                {change !== null && <small className={change >= 0 ? "movement-up" : "movement-down"}>{change >= 0 ? "+" : ""}{numberFormat(change)}</small>}</div>
            </header>
            {result.points.length > 0 && <details className="war-members" open={index === 0}>
              <summary>{t("{count} players", { count: result.points.length })}</summary>
              <WarPlayersTable kind={kind} result={result} byId={byId} />
            </details>}
            <footer>
              {result.imageIds.length > 0 && <div className="war-thumbs">{result.imageIds.map((id, n) => <a key={id} href={`/api/war-results/images/${id}`} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element -- stored screenshot */}
                <img src={`/api/war-results/images/${id}`} alt={t("Screenshot {number}", { number: n + 1 })} loading="lazy" />
              </a>)}</div>}
              {admin && <div className="war-card-actions">
                <button className="button subtle" onClick={() => setEditing(result.id)}><Pencil size={14} />{t("Edit")}</button>
                <button className="button subtle war-delete" onClick={() => void remove(result)}><Trash2 size={14} />{t("Delete")}</button>
              </div>}
            </footer>
          </article>;
        })}
  </div>;
}

/** Short table of clan war totals for the Weekly History page. */
export function WarTotalsHistory({ kind = "war" }: { kind?: RecordKind }) {
  const t = useT();
  const words = TEXT[kind];
  const { results } = useWarResults(kind);
  const rows = (results ?? []).map((result, index, all) => {
    const previous = all.slice(index + 1).find((item) => item.clanTotal !== null);
    const change = result.clanTotal !== null && previous?.clanTotal != null ? result.clanTotal - previous.clanTotal : null;
    return { result, change, top: result.points[0] };
  });
  const { sorted, header } = useSortable(rows, {
    war: ({ result }) => `${result.week}T${result.createdAt}`,
    total: ({ result }) => result.clanTotal,
    change: ({ change }) => change,
    top: ({ top }) => top?.points,
  }, { key: "war", direction: "desc" });
  if (!results?.length) return null;
  return <section className="panel war-history">
    <div className="table-section-heading"><div><h2>{t(words.history)}</h2><p>{t(words.historySub)}</p></div>
      <Link className="text-link" href={kind === "war" ? "/war-results" : "/vial-donations"}>{t(words.link)}</Link></div>
    <div className={`table-scroll${kind === "vials" ? " tone-teal" : ""}`}><table className="resource-table">
      <thead><tr>{header("war", t(words.column))}{header("total", t(words.total), { icon: kind === "vials" ? <VialIcon size={20} /> : <Trophy size={16} aria-hidden="true" /> })}{header("change", t("Change"))}{header("top", t(words.top))}</tr></thead>
      <tbody>{sorted.map(({ result, change, top }) => <tr key={result.id}>
        <td><strong>{result.label || t("Week of {date}", { date: formatWeek(result.week) })}</strong></td>
        <td>{result.clanTotal === null ? "—" : numberFormat(result.clanTotal)}</td>
        <td className={change === null || change === 0 ? "" : change > 0 ? "movement-up" : "movement-down"}>{change === null ? "—" : `${change > 0 ? "+" : ""}${numberFormat(change)}`}</td>
        <td>{top ? `${top.gameName} · ${numberFormat(top.points)}` : "—"}</td>
      </tr>)}</tbody>
    </table></div>
  </section>;
}
