"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowDownToLine, LoaderCircle, RefreshCw } from "lucide-react";
import { downloadRows } from "@/lib/csv";
import { numberFormat } from "@/lib/resources";
import { useLanguage } from "@/lib/i18n";
import type { ContributionRankingResponse, ContributionRow, RankingMetric } from "@/lib/types";
import { MemberAvatar, MemberName } from "./member-identity";
import { useSortable } from "./sortable";
import { useStackFold } from "./stack-fold";
import "./hoarding-watch.css";

const METRIC_LABELS: Record<RankingMetric, string> = {
  warPoints: "War points",
  vials: "Vials donated",
  snipes: "Snipes joined",
  updates: "Weekly updates",
  clanDays: "Spent on clan days",
};

type Column = "rank" | "member" | "score" | "warPoints" | "vials" | "snipes" | "noShows" | "updates" | "clanDays" | "blackMarks" | "days" | "saved";

function scoreClass(score: number) {
  return score < 35 ? "rank-low" : score < 60 ? "rank-mid" : "rank-high";
}

export function ContributionRanking() {
  const { t, language } = useLanguage();
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
    days: (row) => row.daysInClan,
    saved: (row) => row.lastSavedAt ? new Date(row.lastSavedAt).getTime() : null,
  }, { key: "rank", direction: "desc" });
  // On a phone each member is one line (place, name, score) until tapped.
  const fold = useStackFold();
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
        <p>{t("Minus 40 for never signing in to the Clan Hub. Minus 5 for each snipe they said Yes to but missed (up to 15).")}</p>
        <p>{t("Minus 5 for each war where more than 10% of their war points came on days that weren’t clan days (a black mark, up to 15).")}</p>
        {missing.length > 0 && <p className="hoard-typical">{t("Not counted yet (no records): {parts}", { parts: missing.map((metric) => t(METRIC_LABELS[metric])).join(", ") })}</p>}
      </div>
      <div className="rank-controls">
        <button className="button subtle" onClick={() => downloadRows(`turmoil-ranking-${new Date().toISOString().slice(0, 10)}.csv`, [
          ["Rank", "Member", "Score", "Penalty", "War points (avg)", "Wars played", "Vials donated", "Snipes (8 wk)", "No-shows", "Weekly updates", "On clan days (%)", "Black marks", "Strikes", "Holiday until", "Days in clan", "Joined Discord", "Last saved", "Never signed in"],
          ...sorted.map((row) => [row.rank, row.member.username, row.score, row.penalty, row.warPoints === null ? "" : Math.round(row.warPoints), row.warsPlayed, row.vials ?? "", row.snipes, row.noShows, row.updates, row.clanDayShare === null ? "" : Math.round(row.clanDayShare * 100), row.blackMarks, row.member.strikes ?? 0, row.member.holidayUntil ?? "", row.daysInClan, row.member.discordJoinedAt?.slice(0, 10) ?? "", row.lastSavedAt ?? "", row.member.neverSignedIn ? "Yes" : ""]),
        ])}><ArrowDownToLine size={15} />{t("Export CSV")}</button>
        <button className="button subtle" onClick={() => void load()} disabled={loading}><RefreshCw size={15} className={loading ? "spin" : undefined} />{t("Refresh")}</button>
      </div>
    </section>
    <section className="panel">
      <div className="table-scroll"><table className="resource-table rank-table stack-table">
        <thead><tr>
          {header("rank", "#")}{header("member", t("Member"))}{header("score", t("Score"))}
          {header("warPoints", t("War points (avg)"))}{header("vials", t("Vials donated"))}{header("snipes", t("Snipes (8 wk)"))}
          {header("noShows", t("No-shows"))}{header("updates", t("Weekly updates"))}{header("clanDays", t("On clan days"))}{header("blackMarks", t("Black marks"))}
          {header("days", t("Days in clan"))}{header("saved", t("Last saved"))}
        </tr></thead>
        <tbody>{sorted.map((row) => <tr key={row.member.id} {...fold.row(row.member.id)}>
          {/* A plain place number: the lowest scores are who to talk to first, not an award. */}
          <td className="stack-hide"><span className="rank-place">{row.rank}</span></td>
          <td className="stack-title"><div className="table-member"><span className="rank-place stack-only">{row.rank}</span><MemberAvatar member={row.member} small /><div><strong><MemberName member={row.member} /></strong>{row.isNew && <span className="rank-new">{t("New")}</span>}{row.member.neverSignedIn && <span className="rank-never">{t("Never signed in")}</span>}{!!row.member.strikes && <span className="rank-never">⚠️ {t("{count} strikes", { count: row.member.strikes })}</span>}</div></div></td>
          <td className="stack-key" data-label={t("Score")}><span className={`rank-score ${scoreClass(row.score)}`}>{row.score}</span>{row.penalty > 0 && <small className="rank-penalty">−{row.penalty}</small>}</td>
          <td data-label={t("War points (avg)")}>{amount(row.warPoints)}{row.warPoints !== null && <small className="rank-sub">{t("{count} of {total} wars", { count: row.warsPlayed, total: data.records.wars })}</small>}</td>
          <td data-label={t("Vials donated")}>{amount(row.vials)}</td>
          <td data-label={t("Snipes (8 wk)")}>{row.snipes || "—"}</td>
          <td data-label={t("No-shows")} className={row.noShows ? "hoard-up" : undefined}>{row.noShows || "—"}</td>
          <td data-label={t("Weekly updates")}>{row.updates} / 8</td>
          <td data-label={t("On clan days")}>{row.clanDayShare === null ? "—" : `${Math.round(row.clanDayShare * 100)}%`}</td>
          <td data-label={t("Black marks")} className={row.blackMarks ? "hoard-up" : undefined}>{row.blackMarks || "—"}</td>
          <td data-label={t("Days in clan")}>{row.daysInClan}{row.member.discordJoinedAt && <small className="rank-sub">{new Intl.DateTimeFormat(language, { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }).format(new Date(row.member.discordJoinedAt))}</small>}</td>
          <td data-label={t("Last saved")}>{row.lastSavedAt ? t("{days} days ago", { days: Math.floor((Date.now() - new Date(row.lastSavedAt).getTime()) / 86_400_000) }) : t("Never")}</td>
          {fold.toggleCell(row.member.id)}
        </tr>)}</tbody>
      </table></div>
    </section>
  </div>;
}
