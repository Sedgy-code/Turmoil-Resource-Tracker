"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowDownToLine, LoaderCircle, RefreshCw } from "lucide-react";
import { downloadRows } from "@/lib/csv";
import { numberFormat } from "@/lib/resources";
import { useT } from "@/lib/i18n";
import type { ContributionRankingResponse, ContributionRow, RankingMetric } from "@/lib/types";
import { MemberAvatar, MemberName } from "./member-identity";
import { useSortable } from "./sortable";
import "./hoarding-watch.css";

const METRIC_LABELS: Record<RankingMetric, string> = {
  warPoints: "War points",
  vials: "Vials donated",
  snipes: "Snipes joined",
  updates: "Weekly updates",
  clanDays: "Spent on clan days",
};

type Column = "rank" | "member" | "score" | "warPoints" | "vials" | "snipes" | "noShows" | "updates" | "clanDays" | "blackMarks" | "hoarding" | "days" | "saved";

function scoreClass(score: number) {
  return score < 35 ? "rank-low" : score < 60 ? "rank-mid" : "rank-high";
}

export function ContributionRanking() {
  const t = useT();
  const [data, setData] = useState<ContributionRankingResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/ranking", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Please try again.");
      setData(result as ContributionRankingResponse);
    } catch (e) { setError(e instanceof Error ? e.message : "Please try again."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const rows = data?.rows ?? [];
  const { sorted, header } = useSortable<ContributionRow, Column>(rows, {
    rank: (row) => -row.rank,
    member: (row) => row.member.username,
    score: (row) => row.score,
    warPoints: (row) => row.warPoints,
    vials: (row) => row.vials,
    snipes: (row) => row.snipes,
    noShows: (row) => row.noShows,
    updates: (row) => row.updates,
    clanDays: (row) => row.clanDayShare,
    blackMarks: (row) => row.blackMarks,
    hoarding: (row) => row.hoarding === "high" ? 2 : row.hoarding === "watch" ? 1 : row.hoarding === "saver" ? -1 : 0,
    days: (row) => row.daysInClan,
    saved: (row) => row.lastSavedAt ? new Date(row.lastSavedAt).getTime() : null,
  }, { key: "rank", direction: "desc" });
  if (!data) return <section className="panel hoard-state">{error ? <><p>{t(error)}</p><button className="button primary" onClick={() => void load()}>{t("Try again")}</button></> : <LoaderCircle size={24} className="spin" />}</section>;
  const weights = Object.entries(data.weights) as [RankingMetric, number][];
  const missing = (Object.keys(METRIC_LABELS) as RankingMetric[]).filter((metric) => !(metric in data.weights));
  const amount = (value: number | null) => value === null ? "—" : numberFormat(Math.round(value));
  return <div className="hoard-page">
    <section className="panel hoard-intro">
      <div>
        <h2>{t("How the score works")}</h2>
        <p>{t("Each member gets a score out of 100 from how they compare with everyone else. Lowest scores are at the top — talk to them first when you need space.")}</p>
        <ul className="rank-weights">{weights.map(([metric, weight]) => <li key={metric}><strong>{weight}%</strong> {t(METRIC_LABELS[metric])}</li>)}</ul>
        <p>{t("Minus 40 for never signing in to the Clan Hub. Minus points for hoarding (5 or 15) and for saying Yes to a snipe but not turning up (5 each, up to 15). Good savers get +3.")}</p>
        <p>{t("Minus 5 for each war where more than 10% of their war points came on days that weren’t clan days (a black mark, up to 15).")}</p>
        {missing.length > 0 && <p className="hoard-typical">{t("Not counted yet (no records): {parts}", { parts: missing.map((metric) => t(METRIC_LABELS[metric])).join(", ") })}</p>}
      </div>
      <div className="rank-controls">
        <button className="button subtle" onClick={() => downloadRows(`turmoil-ranking-${new Date().toISOString().slice(0, 10)}.csv`, [
          ["Rank", "Member", "Score", "Penalty", "War points (avg)", "Wars played", "Vials donated", "Snipes (8 wk)", "No-shows", "Weekly updates", "On clan days (%)", "Black marks", "Hoarding", "Strikes", "Holiday until", "Days in clan", "Last saved", "Never signed in"],
          ...sorted.map((row) => [row.rank, row.member.username, row.score, row.penalty, row.warPoints === null ? "" : Math.round(row.warPoints), row.warsPlayed, row.vials ?? "", row.snipes, row.noShows, row.updates, row.clanDayShare === null ? "" : Math.round(row.clanDayShare * 100), row.blackMarks, row.hoarding, row.member.strikes ?? 0, row.member.holidayUntil ?? "", row.daysInClan, row.lastSavedAt ?? "", row.member.neverSignedIn ? "Yes" : ""]),
        ])}><ArrowDownToLine size={15} />{t("Export CSV")}</button>
        <button className="button subtle" onClick={() => void load()} disabled={loading}><RefreshCw size={15} className={loading ? "spin" : undefined} />{t("Refresh")}</button>
      </div>
    </section>
    <section className="panel">
      <div className="table-scroll"><table className="resource-table rank-table">
        <thead><tr>
          {header("rank", "#")}{header("member", t("Member"))}{header("score", t("Score"))}
          {header("warPoints", t("War points (avg)"))}{header("vials", t("Vials donated"))}{header("snipes", t("Snipes (8 wk)"))}
          {header("noShows", t("No-shows"))}{header("updates", t("Weekly updates"))}{header("clanDays", t("On clan days"))}{header("blackMarks", t("Black marks"))}
          {header("hoarding", t("Hoarding"))}{header("days", t("Days in clan"))}{header("saved", t("Last saved"))}
        </tr></thead>
        <tbody>{sorted.map((row) => <tr key={row.member.id}>
          <td>{row.rank}</td>
          <td><div className="table-member"><MemberAvatar member={row.member} small /><div><strong><MemberName member={row.member} /></strong>{row.isNew && <span className="rank-new">{t("New")}</span>}{row.member.neverSignedIn && <span className="rank-never">{t("Never signed in")}</span>}{!!row.member.strikes && <span className="rank-never">⚠️ {t("{count} strikes", { count: row.member.strikes })}</span>}</div></div></td>
          <td><span className={`rank-score ${scoreClass(row.score)}`}>{row.score}</span>{row.penalty > 0 && <small className="rank-penalty">−{row.penalty}</small>}</td>
          <td>{amount(row.warPoints)}{row.warPoints !== null && <small className="rank-sub">{t("{count} of {total} wars", { count: row.warsPlayed, total: data.records.wars })}</small>}</td>
          <td>{amount(row.vials)}</td>
          <td>{row.snipes || "—"}</td>
          <td className={row.noShows ? "hoard-up" : undefined}>{row.noShows || "—"}</td>
          <td>{row.updates} / 8</td>
          <td>{row.clanDayShare === null ? "—" : `${Math.round(row.clanDayShare * 100)}%`}</td>
          <td className={row.blackMarks ? "hoard-up" : undefined}>{row.blackMarks || "—"}</td>
          <td>{row.hoarding === "ok" ? "—" : <span className={`hoard-level hoard-level-${row.hoarding}`}>{t(row.hoarding === "high" ? "Hoarding" : row.hoarding === "saver" ? "💰 Good saver" : "Keep an eye on")}</span>}</td>
          <td>{row.daysInClan}</td>
          <td>{row.lastSavedAt ? t("{days} days ago", { days: Math.floor((Date.now() - new Date(row.lastSavedAt).getTime()) / 86_400_000) }) : t("Never")}</td>
        </tr>)}</tbody>
      </table></div>
    </section>
  </div>;
}
