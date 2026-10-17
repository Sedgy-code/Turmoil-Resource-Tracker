"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ImagePlus, LoaderCircle, Pencil, Plus, ScanText, Trash2, Trophy, X } from "lucide-react";
import { currentWeek, formatWeek, numberFormat } from "@/lib/resources";
import { useT } from "@/lib/i18n";
import type { Member, WarReading, WarResult, WarResultsResponse } from "@/lib/types";
import { MemberName } from "./member-identity";
import { useRecognition } from "./recognition";
import { VialDaily } from "./vial-daily";
import { warWeekOf } from "@/lib/war-calendar";
import { mergeReadings, newRow, readGroups, type DraftRow } from "@/lib/war-records";
import { useSortable } from "./sortable";
import "./war-results.css";

type Screenshot = { mime: "image/jpeg"; data: string; preview: string; read?: boolean };
/**
 * Vercel accepts about 4.5 MB per request, so screenshots are read two at a time and saved one at a
 * time after the record. A 50-member list (about 8 screenshots) then never hits that limit.
 */
const MAX_SCREENSHOTS = 15;
/** Must match MAX_RECORD_SCREENSHOTS on the server. */
const MAX_RECORD_SCREENSHOTS = 20;
const READ_AT_ONCE = 3;
/** The server refuses a single screenshot over 2,000,000 characters. */
const MAX_SHOT_CHARS = 1_900_000;

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, headers: { "Content-Type": "application/json", ...options?.headers }, cache: "no-store" });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "Please try again.");
  return result as T;
}

/** Shrinks a screenshot in the browser (longest side 2000px, JPEG) so uploads stay small but readable. */
async function shrink(file: File): Promise<Screenshot> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  let url = canvas.toDataURL("image/jpeg", 0.85);
  // Very detailed screenshots can come out big; a little more compression keeps them under the limit.
  for (const quality of [0.75, 0.6]) if (url.length - url.indexOf(",") - 1 > MAX_SHOT_CHARS) url = canvas.toDataURL("image/jpeg", quality);
  return { mime: "image/jpeg", data: url.slice(url.indexOf(",") + 1), preview: url };
}

const digits = (value: string) => value.replace(/[^0-9]/g, "");

export type RecordKind = "war" | "vials";
/** Wording for each kind of record; the screenshot flow is the same. */
const TEXT = {
  war: {
    add: "Add war results", step1: "Add the end-of-war screenshots (clan total and the member list).",
    total: "Clan total", points: "Points", saved: "War results saved.", deleted: "War result deleted.",
    confirmDelete: "Delete this war result? This can’t be undone.", save: "Save war results",
    empty: "No war results yet. An admin can add them from the end-of-war screenshots.", chart: "Clan total over time",
    history: "Clan war totals", historySub: "Final clan scores from each war.", link: "War Results", top: "Top scorer",
    labelExample: "e.g. Season 30 · War 4", date: "War date", column: "War",
  },
  vials: {
    add: "Add vial donations", step1: "Add the clan tech donation screenshots (the member list with vials).",
    total: "Total vials", points: "Vials", saved: "Vial donations saved.", deleted: "Vial record deleted.",
    confirmDelete: "Delete this vial record? This can’t be undone.", save: "Save vial donations",
    empty: "No vial donations yet. An admin can add them from the clan tech screenshots.", chart: "Vials donated over time",
    history: "Tech vial donations", historySub: "Vials donated to clan tech, from each upload.", link: "Vial Donations", top: "Top donor",
    labelExample: "e.g. Week 4 donations", date: "Date", column: "Record",
  },
} as const;
const compact = (value: number) => value >= 1e6 ? `${numberFormat(Math.round(value / 1e5) / 10)}M` : value >= 1e4 ? `${numberFormat(Math.round(value / 100) / 10)}K` : numberFormat(value);
/** Add a new record from screenshots, or fix a saved one: change numbers, add missing players, add screenshots. */
function RecordEditor({ kind, members, existing, onSaved, onClose, notify }: {
  kind: RecordKind;
  members: Member[];
  existing?: WarResult;
  onSaved: () => void;
  onClose: () => void;
  notify: (message: string, error?: boolean) => void;
}) {
  const t = useT();
  const words = TEXT[kind];
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [label, setLabel] = useState(existing?.label ?? "");
  const [shots, setShots] = useState<Screenshot[]>([]);
  const [rows, setRows] = useState<DraftRow[]>(() => (existing?.points ?? []).map((point) => newRow({ gameName: point.gameName, memberId: point.memberId ?? "", points: String(point.points) })));
  const [clanTotal, setClanTotal] = useState(existing?.clanTotal != null ? String(existing.clanTotal) : "");
  const [busy, setBusy] = useState<"" | "reading" | "saving" | "adding">("");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [message, setMessage] = useState("");
  const [focusKey, setFocusKey] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const sortedMembers = useMemo(() => [...members].filter((member) => member.active).sort((a, b) => a.username.localeCompare(b.username)), [members]);
  const room = Math.max(0, Math.min(MAX_SCREENSHOTS, MAX_RECORD_SCREENSHOTS - (existing?.imageIds.length ?? 0)) - shots.length);
  const unread = shots.filter((shot) => !shot.read);
  const present = new Set(rows.map((row) => row.memberId).filter(Boolean));
  const missing = sortedMembers.filter((member) => !present.has(member.id));

  async function addFiles(files: FileList | null) {
    if (!files?.length) return;
    setBusy("adding");
    setMessage("");
    try {
      const added: Screenshot[] = [];
      for (const file of [...files].slice(0, room)) added.push(await shrink(file));
      setShots((current) => [...current, ...added]);
      if (files.length > room) setMessage(t("Up to {count} screenshots at a time.", { count: MAX_SCREENSHOTS }));
    } catch {
      setMessage(t("One of those files couldn’t be opened as a picture."));
    } finally {
      setBusy("");
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function read() {
    const groups = readGroups(unread);
    if (!groups.length) return;
    setBusy("reading");
    setMessage("");
    setProgress({ done: 0, total: groups.length });
    const readings: (WarReading | null)[] = groups.map(() => null);
    let next = 0;
    let done = 0;
    let lastError = "";
    const worker = async () => {
      while (next < groups.length) {
        const index = next++;
        try {
          readings[index] = (await request<{ reading: WarReading }>("/api/war-results/read", {
            method: "POST", body: JSON.stringify({ kind, images: groups[index].map(({ mime, data }) => ({ mime, data })) }),
          })).reading;
        } catch (error) {
          lastError = error instanceof Error ? error.message : "Please try again.";
        }
        setProgress({ done: ++done, total: groups.length });
      }
    };
    await Promise.all(Array.from({ length: Math.min(READ_AT_ONCE, groups.length) }, worker));
    const found = readings.filter((reading): reading is WarReading => reading !== null);
    // Screenshots that were read aren't sent again; ones that failed can be retried with the same button.
    const readShots = new Set(groups.filter((_, index) => readings[index] !== null).flat());
    setShots((current) => current.map((shot) => readShots.has(shot) ? { ...shot, read: true } : shot));
    const merged = mergeReadings(rows, found);
    const total = found.find((reading) => reading.clanTotal !== null)?.clanTotal ?? null;
    if (total !== null && !clanTotal) setClanTotal(String(total));
    const unmatched = merged.rows.filter((row) => !row.memberId).length;
    const needNumbers = merged.rows.filter((row) => !row.points).length;
    const parts: string[] = [];
    if (!found.length) parts.push(t(lastError));
    else if (existing) parts.push(t("Added {count} players from the new screenshots.", { count: merged.added }));
    else parts.push(merged.rows.length
      ? t("Found {count} players. Check the numbers, pick a member for any amber rows, then press Save.", { count: merged.rows.length })
      : t("No players found. Type them in below, or try clearer screenshots."));
    if (found.length && unmatched) parts.push(t("{count} name(s) need a member picked.", { count: unmatched }));
    if (found.length && needNumbers) parts.push(t("{count} number(s) need typing in.", { count: needNumbers }));
    if (found.length && found.length < groups.length) parts.push(t("Some screenshots couldn’t be read. Try them again, or add the missing members by hand."));
    setRows(merged.rows.length ? merged.rows : [newRow()]);
    setMessage(parts.join(" "));
    setBusy("");
  }

  async function save() {
    const cleaned = rows.filter((row) => row.gameName.trim() || row.memberId || row.points);
    if (cleaned.some((row) => !row.points || !(row.gameName.trim() || row.memberId))) {
      setMessage(t("Every row needs a name and points (or remove the row)."));
      return;
    }
    if (!cleaned.length && !clanTotal) {
      setMessage(t("Add the clan total or at least one member’s points."));
      return;
    }
    setBusy("saving");
    try {
      const content = {
        label: label.trim(),
        clanTotal: clanTotal ? Number(clanTotal) : null,
        rows: cleaned.map((row) => ({
          gameName: row.gameName.trim() || members.find((member) => member.id === row.memberId)?.username || "Member",
          memberId: row.memberId || null,
          points: Number(row.points),
        })),
      };
      const id = existing
        ? (await request<{ result: WarResult }>(`/api/war-results/${existing.id}`, { method: "PATCH", body: JSON.stringify(content) })).result.id
        : (await request<{ result: WarResult }>("/api/war-results", {
          method: "POST",
          body: JSON.stringify({
            kind,
            // A war runs Tuesday–Monday, so results saved on Day 7 (Monday) belong to the war that just ended.
            week: kind === "war" ? warWeekOf(new Date(`${date}T12:00:00Z`)) : currentWeek(new Date(`${date}T12:00:00Z`)),
            ...content,
            images: [],
          }),
        })).result.id;
      // Screenshots go up one at a time, so a long list never hits the upload size limit.
      let unsaved = 0;
      for (const shot of shots) {
        try { await request(`/api/war-results/${id}/images`, { method: "POST", body: JSON.stringify({ images: [{ mime: shot.mime, data: shot.data }] }) }); }
        catch { unsaved++; }
      }
      if (unsaved) notify(t("Saved, but some screenshots couldn’t be stored."), true);
      else notify(existing ? t("Changes saved.") : t(words.saved));
      onSaved();
    } catch (error) {
      const text = error instanceof Error ? error.message : "Please try again.";
      setMessage(t(text));
      setBusy("");
    }
  }

  function addMissing(member: Member) {
    const row = newRow({ gameName: member.username, memberId: member.id });
    setRows((current) => [...current, row]);
    setFocusKey(row.key);
  }

  const update = (key: string, change: Partial<DraftRow>) => setRows((current) => current.map((row) => row.key === key ? { ...row, ...change } : row));
  return <section className="panel war-add">
    <div className="war-add-head">
      <h2>{existing ? <Pencil size={17} /> : <Trophy size={17} />}{existing ? `${t("Edit")}: ${existing.label || t("Week of {date}", { date: formatWeek(existing.week) })}` : t(words.add)}</h2>
      <button className="icon-button" aria-label={t("Close")} onClick={onClose}><X size={17} /></button>
    </div>
    {!existing && <ol className="war-steps">
      <li>{t(words.step1)}</li>
      <li>{t("Press “Read screenshots”. The site fills in the table for you.")}</li>
      <li>{t("Check the numbers, fix anything wrong, then press Save.")}</li>
    </ol>}
    <div className="war-form-grid">
      {!existing && <label><span>{t(words.date)}</span><input type="date" value={date} onChange={(event) => event.target.value && setDate(event.target.value)} /></label>}
      <label><span>{t("Name (optional)")}</span><input value={label} maxLength={120} placeholder={t(words.labelExample)} onChange={(event) => setLabel(event.target.value)} /></label>
    </div>
    <div className="war-shots">
      {shots.map((shot, index) => <figure key={index}>
        {/* eslint-disable-next-line @next/next/no-img-element -- local preview */}
        <img src={shot.preview} alt={t("Screenshot {number}", { number: index + 1 })} />
        <button className="icon-button" aria-label={t("Remove screenshot {number}", { number: index + 1 })} onClick={() => setShots((current) => current.filter((_, i) => i !== index))}><X size={14} /></button>
      </figure>)}
      {room > 0 && <button className="war-shot-add" onClick={() => fileInput.current?.click()} disabled={busy !== ""}>
        {busy === "adding" ? <LoaderCircle size={20} className="spin" /> : <ImagePlus size={20} />}<span>{t("Add screenshots")}</span>
      </button>}
      <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={(event) => void addFiles(event.target.files)} />
    </div>
    <div className="war-actions">
      <button className="button primary" disabled={!unread.length || busy !== ""} onClick={() => void read()}>
        {busy === "reading" ? <LoaderCircle size={15} className="spin" /> : <ScanText size={15} />}{busy === "reading" ? t("Reading… {done} of {total}", { done: progress.done, total: progress.total }) : t("Read screenshots")}
      </button>
      {!rows.length && <button className="button subtle" onClick={() => setRows([newRow()])}>{t("Type them in instead")}</button>}
    </div>
    {message && <p className="war-message" role="status">{message}</p>}
    {(rows.length > 0 || clanTotal) && <>
      <label className="war-total-field"><span>{t(words.total)}</span><input inputMode="numeric" value={clanTotal} onChange={(event) => setClanTotal(digits(event.target.value))} placeholder="0" /></label>
      <div className="table-scroll"><table className="resource-table war-edit-table">
        <thead><tr><th>{t("Name in game")}</th><th>{t("Clan member")}</th><th>{t(words.points)}</th><th><span className="visually-hidden">{t("Remove")}</span></th></tr></thead>
        <tbody>{rows.map((row) => <tr key={row.key} className={[row.memberId ? "" : "war-unmatched", row.points ? "" : "war-no-number"].filter(Boolean).join(" ") || undefined}>
          <td><input aria-label={t("Name in game")} value={row.gameName} maxLength={80} onChange={(event) => update(row.key, { gameName: event.target.value })} /></td>
          <td><select aria-label={t("Clan member")} value={row.memberId} onChange={(event) => update(row.key, { memberId: event.target.value })}>
            <option value="">{t("— Pick a member —")}</option>
            {sortedMembers.map((member) => <option key={member.id} value={member.id}>{member.username}</option>)}
          </select></td>
          <td><input aria-label={t(words.points)} inputMode="numeric" value={row.points} autoFocus={row.key === focusKey} onChange={(event) => update(row.key, { points: digits(event.target.value) })} /></td>
          <td><button className="icon-button" aria-label={t("Remove")} onClick={() => setRows((current) => current.filter((item) => item.key !== row.key))}><Trash2 size={15} /></button></td>
        </tr>)}</tbody>
      </table></div>
      {missing.length > 0 && <div className="war-missing">
        <p>{t("Not in this list yet ({count}). Tap a name to add them:", { count: missing.length })}</p>
        <div className="war-missing-list">{missing.map((member) => <button key={member.id} type="button" className="war-missing-chip" onClick={() => addMissing(member)}><Plus size={13} aria-hidden="true" />{member.username}</button>)}</div>
      </div>}
      <div className="war-actions">
        <button className="button subtle" onClick={() => setRows((current) => [...current, newRow()])}><Plus size={15} />{t("Add a row")}</button>
        <button className="button primary" disabled={busy !== ""} onClick={() => void save()}>{busy === "saving" && <LoaderCircle size={15} className="spin" />}{existing ? t("Save changes") : t(words.save)}</button>
      </div>
      <p className="war-hint">{t("Names you match are remembered, so next time they’re matched automatically.")}</p>
    </>}
  </section>;
}

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
  return <div className="table-scroll"><table className="resource-table war-table">
    <thead><tr>{header("rank", "#")}{header("member", t("Member"))}{header("points", t(TEXT[kind].points))}</tr></thead>
    <tbody>{sorted.map((point) => {
      const member = point.memberId ? byId.get(point.memberId) : undefined;
      return <tr key={point.position}>
        <td>{point.rank < 3 ? ["🥇", "🥈", "🥉"][point.rank] : point.rank + 1}</td>
        <td>{member ? <MemberName member={member} /> : <span className="war-guest">{point.gameName}</span>}</td>
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
    <div className="table-scroll"><table className="resource-table">
      <thead><tr>{header("war", t(words.column))}{header("total", t(words.total))}{header("change", t("Change"))}{header("top", t(words.top))}</tr></thead>
      <tbody>{sorted.map(({ result, change, top }) => <tr key={result.id}>
        <td><strong>{result.label || t("Week of {date}", { date: formatWeek(result.week) })}</strong></td>
        <td>{result.clanTotal === null ? "—" : numberFormat(result.clanTotal)}</td>
        <td className={change === null || change === 0 ? "" : change > 0 ? "movement-up" : "movement-down"}>{change === null ? "—" : `${change > 0 ? "+" : ""}${numberFormat(change)}`}</td>
        <td>{top ? `${top.gameName} · ${numberFormat(top.points)}` : "—"}</td>
      </tr>)}</tbody>
    </table></div>
  </section>;
}
