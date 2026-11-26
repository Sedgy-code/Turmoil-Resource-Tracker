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
  updates: "Weekly updates",
};

type Column = "rank" | "member" | "score" | "warPoints" | "vials" | "updates" | "strikes" | "days" | "saved";

function scoreClass(score: number) {
  return score < 35 ? "rank-low" : score < 60 ? "rank-mid" : "rank-high";
}

/** A share such as "3 / 4", or a dash when there was nothing to count. */
const share = (done: number, due: number) => due > 0 ? `${done} / ${due}` : "—";
const rate = (done: number, due: number) => due > 0 ? done / due : null;

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
  // Members settling in aren't scored yet: they get their own list below the ranking.
  const ranked = rows.filter((row) => !row.settling);
  const settling = rows.filter((row) => row.settling);
  const { sorted, header } = useSortable<ContributionRow, Column>(ranked, {
    rank: (row) => -row.rank,
    member: (row) => row.member.username,
    score: (row) => row.score,
    warPoints: (row) => row.warPoints,
    vials: (row) => row.vials,
    updates: (row) => rate(row.updates, row.updatesDue),
    strikes: (row) => row.member.strikes ?? 0,
    days: (row) => row.daysInClan,
    saved: (row) => row.lastSavedAt ? new Date(row.lastSavedAt).getTime() : null,
  }, { key: "rank", direction: "desc" });
  // On a phone each member is one line (place, name, score) until tapped.
  const fold = useStackFold();
  if (!data) return <section className="panel hoard-state">{error ? <><p>{t(error)}</p><button className="button primary" onClick={() => void load()}>{t("Try again")}</button></> : <LoaderCircle size={24} className="spin" />}</section>;
  const weights = Object.entries(data.weights) as [RankingMetric, number][];
  const missing = (Object.keys(METRIC_LABELS) as RankingMetric[]).filter((metric) => !(metric in data.weights));
  const amount = (value: number | null) => value === null ? "—" : numberFormat(Math.round(value));
  const wars = (row: ContributionRow) => row.warsCounted > 0 && <small className="rank-sub">{t("{count} of {total} wars", { count: row.warsPlayed, total: row.warsCounted })}</small>;
  const joinedOn = (row: ContributionRow) => row.member.discordJoinedAt && <small className="rank-sub">{new Intl.DateTimeFormat(language, { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }).format(new Date(row.member.discordJoinedAt))}</small>;
  const lastSaved = (row: ContributionRow) => row.lastSavedAt ? t("{days} days ago", { days: Math.floor((Date.now() - new Date(row.lastSavedAt).getTime()) / 86_400_000) }) : t("Never");
  const badges = (row: ContributionRow, strikes = true) => <>{row.member.neverSignedIn && <span className="rank-never">{t("Never signed in")}</span>}{strikes && !!row.member.strikes && <span className="rank-never">⚠️ {t("{count} strikes", { count: row.member.strikes })}</span>}</>;
  return <div className="hoard-page">
    <section className="panel hoard-intro">
      <div>
        <h2>{t("How the score works")}</h2>
        <p>{t("Each member gets a score out of 100 from how they compare with everyone else. Lowest scores are at the top — talk to them first when you need space.")}</p>
        <ul className="rank-weights">{weights.map(([metric, weight]) => <li key={metric}><strong>{weight}%</strong> {t(METRIC_LABELS[metric])}</li>)}</ul>
        <p>{t("Everything counts only from when each member joined, so time in the clan doesn’t raise or lower the score.")}</p>
        <p>{t("Weekly updates: weeks saved out of their own weeks in the clan (last 8 weeks).")}</p>
        <p>{t("Snipes and spending on clan days don’t count: not everyone can make snipes (time zones, other commitments), and the daily war screenshots aren’t kept.")}</p>
        <p>{t("Vials: donating at least 80% of what a typical member gives earns full marks, as ascension bonuses differ (5% to 60%).")}</p>
        <p>{t("Minus 40 for never signing in to the Clan Hub.")}</p>
        <p>{t("Minus 5 for each strike leaders have given (up to 15).")}</p>
        {missing.length > 0 && <p className="hoard-typical">{t("Not counted yet (no records): {parts}", { parts: missing.map((metric) => t(METRIC_LABELS[metric])).join(", ") })}</p>}
      </div>
      <div className="rank-controls">
        <button className="button subtle" onClick={() => downloadRows(`turmoil-ranking-${new Date().toISOString().slice(0, 10)}.csv`, [
          ["Rank", "Member", "Score", "Penalty", "War points (avg)", "Wars played", "Wars counted", "Vials donated (avg)", "Weekly updates", "Weeks counted", "Strikes", "Holiday until", "Days in clan", "Joined Discord", "Last saved", "Never signed in", "Settling in"],
          ...[...sorted, ...settling].map((row) => [row.settling ? "" : row.rank, row.member.username, row.settling ? "" : row.score, row.penalty, row.warPoints === null ? "" : Math.round(row.warPoints), row.warsPlayed, row.warsCounted, row.vials === null ? "" : Math.round(row.vials), row.updates, row.updatesDue, row.member.strikes ?? 0, row.member.holidayUntil ?? "", row.daysInClan, row.member.discordJoinedAt?.slice(0, 10) ?? "", row.lastSavedAt ?? "", row.member.neverSignedIn ? "Yes" : "", row.settling ? "Yes" : ""]),
        ])}><ArrowDownToLine size={15} />{t("Export CSV")}</button>
        <button className="button subtle" onClick={() => void load()} disabled={loading}><RefreshCw size={15} className={loading ? "spin" : undefined} />{t("Refresh")}</button>
      </div>
    </section>
    <section className="panel">
      <div className="table-scroll"><table className="resource-table rank-table stack-table">
        <thead><tr>
          {header("rank", "#")}{header("member", t("Member"))}{header("score", t("Score"))}
          {header("warPoints", t("War points (avg)"))}{header("vials", t("Vials donated"))}
          {header("updates", t("Weekly updates"))}{header("strikes", t("Strikes"))}
          {header("days", t("Days in clan"))}{header("saved", t("Last saved"))}
        </tr></thead>
        <tbody>{sorted.map((row) => <tr key={row.member.id} {...fold.row(row.member.id)}>
          {/* A plain place number: the lowest scores are who to talk to first, not an award. */}
          <td className="stack-hide"><span className="rank-place">{row.rank}</span></td>
          <td className="stack-title"><div className="table-member"><span className="rank-place stack-only">{row.rank}</span><MemberAvatar member={row.member} small /><div><strong><MemberName member={row.member} /></strong>{badges(row, false)}</div></div></td>
          <td className="stack-key" data-label={t("Score")}><span className={`rank-score ${scoreClass(row.score)}`}>{row.score}</span>{row.penalty > 0 && <small className="rank-penalty">−{row.penalty}</small>}</td>
          <td data-label={t("War points (avg)")}>{amount(row.warPoints)}{wars(row)}</td>
          <td data-label={t("Vials donated")}>{amount(row.vials)}</td>
          <td data-label={t("Weekly updates")}>{share(row.updates, row.updatesDue)}</td>
          <td data-label={t("Strikes")} className={row.member.strikes ? "hoard-up" : undefined}>{row.member.strikes || "—"}</td>
          <td data-label={t("Days in clan")}>{row.daysInClan}{joinedOn(row)}</td>
          <td data-label={t("Last saved")}>{lastSaved(row)}</td>
          {fold.toggleCell(row.member.id)}
        </tr>)}</tbody>
      </table></div>
    </section>
    {settling.length > 0 && <section className="panel rank-settling">
      <div className="rank-settling-head">
        <h2>{t("Settling in")} <span className="rank-new">{settling.length}</span></h2>
        <p>{t("New members in their first two weeks, or who haven’t had a full war since joining. They aren’t scored or ranked yet — here’s how they’re getting on.")}</p>
      </div>
      <div className="table-scroll"><table className="resource-table rank-table stack-table">
        <thead><tr>
          <th>{t("Member")}</th><th>{t("Days in clan")}</th><th>{t("War points (avg)")}</th><th>{t("Weekly updates")}</th><th>{t("Last saved")}</th>
        </tr></thead>
        <tbody>{settling.map((row) => <tr key={row.member.id} {...fold.row(row.member.id)}>
          <td className="stack-title"><div className="table-member"><MemberAvatar member={row.member} small /><div><strong><MemberName member={row.member} /></strong>{badges(row)}</div></div></td>
          <td className="stack-key" data-label={t("Days in clan")}>{row.daysInClan}{joinedOn(row)}</td>
          <td data-label={t("War points (avg)")}>{amount(row.warPoints)}{wars(row)}</td>
          <td data-label={t("Weekly updates")}>{share(row.updates, row.updatesDue)}</td>
          <td data-label={t("Last saved")}>{lastSaved(row)}</td>
          {fold.toggleCell(row.member.id)}
        </tr>)}</tbody>
      </table></div>
    </section>}
  </div>;
}
