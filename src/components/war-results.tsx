"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ImagePlus, LoaderCircle, Plus, ScanText, Trash2, Trophy, X } from "lucide-react";
import { currentWeek, formatWeek, numberFormat } from "@/lib/resources";
import { useT } from "@/lib/i18n";
import type { Member, WarReading, WarResult, WarResultsResponse } from "@/lib/types";
import { MemberName } from "./member-identity";
import { useRecognition } from "./recognition";
import "./war-results.css";

type Screenshot = { mime: "image/jpeg"; data: string; preview: string };
type DraftRow = { key: string; gameName: string; memberId: string; points: string };
/** Vercel accepts about 4.5 MB per request; screenshots are shrunk and capped below that. */
const MAX_UPLOAD_CHARS = 3_800_000;
const MAX_SCREENSHOTS = 6;

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
  const url = canvas.toDataURL("image/jpeg", 0.85);
  return { mime: "image/jpeg", data: url.slice(url.indexOf(",") + 1), preview: url };
}

const digits = (value: string) => value.replace(/[^0-9]/g, "");
let rowCounter = 0;
const newRow = (row?: Partial<DraftRow>): DraftRow => ({ key: `row-${++rowCounter}`, gameName: "", memberId: "", points: "", ...row });

function AddWarResult({ members, onSaved, notify }: { members: Member[]; onSaved: () => void; notify: (message: string, error?: boolean) => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [label, setLabel] = useState("");
  const [shots, setShots] = useState<Screenshot[]>([]);
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [clanTotal, setClanTotal] = useState("");
  const [busy, setBusy] = useState<"" | "reading" | "saving" | "adding">("");
  const [message, setMessage] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const sortedMembers = useMemo(() => [...members].filter((member) => member.active).sort((a, b) => a.username.localeCompare(b.username)), [members]);
  const uploadSize = shots.reduce((total, shot) => total + shot.data.length, 0);

  async function addFiles(files: FileList | null) {
    if (!files?.length) return;
    setBusy("adding");
    setMessage("");
    try {
      const added: Screenshot[] = [];
      for (const file of [...files].slice(0, MAX_SCREENSHOTS - shots.length)) added.push(await shrink(file));
      const next = [...shots, ...added];
      if (next.reduce((total, shot) => total + shot.data.length, 0) > MAX_UPLOAD_CHARS) {
        setMessage(t("That’s too much at once. Use fewer screenshots (up to {count}).", { count: Math.max(1, shots.length) }));
      } else setShots(next);
      if (files.length > MAX_SCREENSHOTS - shots.length) setMessage(t("Up to {count} screenshots per war.", { count: MAX_SCREENSHOTS }));
    } catch {
      setMessage(t("One of those files couldn’t be opened as a picture."));
    } finally {
      setBusy("");
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function read() {
    setBusy("reading");
    setMessage("");
    try {
      const { reading } = await request<{ reading: WarReading }>("/api/war-results/read", {
        method: "POST", body: JSON.stringify({ images: shots.map(({ mime, data }) => ({ mime, data })) }),
      });
      setRows(reading.rows.map((row) => newRow({ gameName: row.gameName, memberId: row.memberId ?? "", points: String(row.points) })));
      if (reading.clanTotal !== null) setClanTotal(String(reading.clanTotal));
      const unmatched = reading.rows.filter((row) => !row.memberId).length;
      setMessage(reading.rows.length
        ? t("Found {count} players. Check the numbers, pick a member for any amber rows, then press Save.", { count: reading.rows.length }) + (unmatched ? ` ${t("{count} name(s) need a member picked.", { count: unmatched })}` : "")
        : t("No players found. Type them in below, or try clearer screenshots."));
    } catch (error) {
      const text = error instanceof Error ? error.message : "Please try again.";
      setMessage(t(text));
      if (!rows.length) setRows([newRow()]);
    } finally { setBusy(""); }
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
      await request("/api/war-results", {
        method: "POST",
        body: JSON.stringify({
          week: currentWeek(new Date(`${date}T12:00:00Z`)),
          label: label.trim(),
          clanTotal: clanTotal ? Number(clanTotal) : null,
          rows: cleaned.map((row) => ({
            gameName: row.gameName.trim() || members.find((member) => member.id === row.memberId)?.username || "Member",
            memberId: row.memberId || null,
            points: Number(row.points),
          })),
          images: shots.map(({ mime, data }) => ({ mime, data })),
        }),
      });
      notify(t("War results saved."));
      setShots([]); setRows([]); setClanTotal(""); setLabel(""); setMessage(""); setOpen(false);
      onSaved();
    } catch (error) {
      const text = error instanceof Error ? error.message : "Please try again.";
      setMessage(t(text));
    } finally { setBusy(""); }
  }

  const update = (key: string, change: Partial<DraftRow>) => setRows((current) => current.map((row) => row.key === key ? { ...row, ...change } : row));
  if (!open) return <button className="button primary war-add-open" onClick={() => setOpen(true)}><Plus size={16} />{t("Add war results")}</button>;
  return <section className="panel war-add">
    <div className="war-add-head">
      <h2><Trophy size={17} />{t("Add war results")}</h2>
      <button className="icon-button" aria-label={t("Close")} onClick={() => setOpen(false)}><X size={17} /></button>
    </div>
    <ol className="war-steps">
      <li>{t("Add the end-of-war screenshots (clan total and the member list).")}</li>
      <li>{t("Press “Read screenshots”. The site fills in the table for you.")}</li>
      <li>{t("Check the numbers, fix anything wrong, then press Save.")}</li>
    </ol>
    <div className="war-form-grid">
      <label><span>{t("War date")}</span><input type="date" value={date} onChange={(event) => event.target.value && setDate(event.target.value)} /></label>
      <label><span>{t("Name (optional)")}</span><input value={label} maxLength={120} placeholder={t("e.g. Season 30 · War 4")} onChange={(event) => setLabel(event.target.value)} /></label>
    </div>
    <div className="war-shots">
      {shots.map((shot, index) => <figure key={index}>
        {/* eslint-disable-next-line @next/next/no-img-element -- local preview */}
        <img src={shot.preview} alt={t("Screenshot {number}", { number: index + 1 })} />
        <button className="icon-button" aria-label={t("Remove screenshot {number}", { number: index + 1 })} onClick={() => setShots((current) => current.filter((_, i) => i !== index))}><X size={14} /></button>
      </figure>)}
      {shots.length < MAX_SCREENSHOTS && <button className="war-shot-add" onClick={() => fileInput.current?.click()} disabled={busy !== ""}>
        {busy === "adding" ? <LoaderCircle size={20} className="spin" /> : <ImagePlus size={20} />}<span>{t("Add screenshots")}</span>
      </button>}
      <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={(event) => void addFiles(event.target.files)} />
    </div>
    <div className="war-actions">
      <button className="button primary" disabled={!shots.length || busy !== "" || uploadSize > MAX_UPLOAD_CHARS} onClick={() => void read()}>
        {busy === "reading" ? <LoaderCircle size={15} className="spin" /> : <ScanText size={15} />}{busy === "reading" ? t("Reading… (up to a minute)") : t("Read screenshots")}
      </button>
      {!rows.length && <button className="button subtle" onClick={() => setRows([newRow()])}>{t("Type them in instead")}</button>}
    </div>
    {message && <p className="war-message" role="status">{message}</p>}
    {(rows.length > 0 || clanTotal) && <>
      <label className="war-total-field"><span>{t("Clan total")}</span><input inputMode="numeric" value={clanTotal} onChange={(event) => setClanTotal(digits(event.target.value))} placeholder="0" /></label>
      <div className="table-scroll"><table className="resource-table war-edit-table">
        <thead><tr><th>{t("Name in game")}</th><th>{t("Clan member")}</th><th>{t("Points")}</th><th><span className="visually-hidden">{t("Remove")}</span></th></tr></thead>
        <tbody>{rows.map((row) => <tr key={row.key} className={row.memberId ? undefined : "war-unmatched"}>
          <td><input aria-label={t("Name in game")} value={row.gameName} maxLength={80} onChange={(event) => update(row.key, { gameName: event.target.value })} /></td>
          <td><select aria-label={t("Clan member")} value={row.memberId} onChange={(event) => update(row.key, { memberId: event.target.value })}>
            <option value="">{t("— Pick a member —")}</option>
            {sortedMembers.map((member) => <option key={member.id} value={member.id}>{member.username}</option>)}
          </select></td>
          <td><input aria-label={t("Points")} inputMode="numeric" value={row.points} onChange={(event) => update(row.key, { points: digits(event.target.value) })} /></td>
          <td><button className="icon-button" aria-label={t("Remove")} onClick={() => setRows((current) => current.filter((item) => item.key !== row.key))}><Trash2 size={15} /></button></td>
        </tr>)}</tbody>
      </table></div>
      <div className="war-actions">
        <button className="button subtle" onClick={() => setRows((current) => [...current, newRow()])}><Plus size={15} />{t("Add a row")}</button>
        <button className="button primary" disabled={busy !== ""} onClick={() => void save()}>{busy === "saving" && <LoaderCircle size={15} className="spin" />}{t("Save war results")}</button>
      </div>
      <p className="war-hint">{t("Names you match are remembered, so next time they’re matched automatically.")}</p>
    </>}
  </section>;
}

function useWarResults() {
  const [results, setResults] = useState<WarResult[] | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try { setResults((await request<WarResultsResponse>("/api/war-results")).results); setError(""); }
    catch (e) { setError(e instanceof Error ? e.message : "Please try again."); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  return { results, error, load };
}

export function WarResults({ members, admin, notify }: { members: Member[]; admin: boolean; notify: (message: string, error?: boolean) => void }) {
  const t = useT();
  const { results, error, load } = useWarResults();
  const { reload: reloadRecognition } = useRecognition();
  const byId = new Map(members.map((member) => [member.id, member]));
  const chart = [...(results ?? [])].filter((result) => result.clanTotal !== null).slice(0, 12).reverse();
  const highest = Math.max(1, ...chart.map((result) => result.clanTotal ?? 0));
  async function remove(result: WarResult) {
    if (!window.confirm(t("Delete this war result? This can’t be undone."))) return;
    try {
      await request(`/api/war-results/${result.id}`, { method: "DELETE" });
      notify(t("War result deleted."));
      await load(); await reloadRecognition();
    } catch (e) {
      const text = e instanceof Error ? e.message : "Please try again.";
      notify(t(text), true);
    }
  }
  return <div className="war-page">
    {admin && <AddWarResult members={members} notify={notify} onSaved={() => { void load(); void reloadRecognition(); }} />}
    {chart.length > 1 && <section className="panel war-chart">
      <h2>{t("Clan total over time")}</h2>
      <div className="war-bars" role="list">{chart.map((result) => <div key={result.id} role="listitem" className="war-bar" title={`${result.label || formatWeek(result.week)}: ${numberFormat(result.clanTotal ?? 0)}`}>
        <span className="war-bar-value">{numberFormat(Math.round((result.clanTotal ?? 0) / 1e6))}M</span>
        <i style={{ height: `${Math.max(4, ((result.clanTotal ?? 0) / highest) * 100)}%` }} />
        <span className="war-bar-label">{formatWeek(result.week)}</span>
      </div>)}</div>
    </section>}
    {error && <div className="error-banner" role="alert">{t(error)}<button onClick={() => void load()}>{t("Retry")}</button></div>}
    {!results ? <section className="panel war-empty"><LoaderCircle size={22} className="spin" /></section>
      : !results.length ? <section className="panel war-empty"><Trophy size={30} /><p>{t("No war results yet. An admin can add them from the end-of-war screenshots.")}</p></section>
        : results.map((result, index) => {
          const previous = results.slice(index + 1).find((item) => item.clanTotal !== null);
          const change = result.clanTotal !== null && previous?.clanTotal != null ? result.clanTotal - previous.clanTotal : null;
          return <article className="panel war-card" key={result.id}>
            <header>
              <div><h2>{result.label || t("Week of {date}", { date: formatWeek(result.week) })}</h2>{result.label && <p>{t("Week of {date}", { date: formatWeek(result.week) })}</p>}</div>
              <div className="war-card-total"><span>{t("Clan total")}</span><strong>{result.clanTotal === null ? "—" : numberFormat(result.clanTotal)}</strong>
                {change !== null && <small className={change >= 0 ? "movement-up" : "movement-down"}>{change >= 0 ? "+" : ""}{numberFormat(change)}</small>}</div>
            </header>
            {result.points.length > 0 && <details className="war-members" open={index === 0}>
              <summary>{t("{count} players", { count: result.points.length })}</summary>
              <div className="table-scroll"><table className="resource-table war-table">
                <thead><tr><th>#</th><th>{t("Member")}</th><th>{t("Points")}</th></tr></thead>
                <tbody>{result.points.map((point, rank) => {
                  const member = point.memberId ? byId.get(point.memberId) : undefined;
                  return <tr key={point.position}>
                    <td>{rank < 3 ? ["🥇", "🥈", "🥉"][rank] : rank + 1}</td>
                    <td>{member ? <MemberName member={member} /> : <span className="war-guest">{point.gameName}</span>}</td>
                    <td className="war-points">{numberFormat(point.points)}</td>
                  </tr>;
                })}</tbody>
              </table></div>
            </details>}
            <footer>
              {result.imageIds.length > 0 && <div className="war-thumbs">{result.imageIds.map((id, n) => <a key={id} href={`/api/war-results/images/${id}`} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element -- stored screenshot */}
                <img src={`/api/war-results/images/${id}`} alt={t("Screenshot {number}", { number: n + 1 })} loading="lazy" />
              </a>)}</div>}
              {admin && <button className="button subtle war-delete" onClick={() => void remove(result)}><Trash2 size={14} />{t("Delete")}</button>}
            </footer>
          </article>;
        })}
  </div>;
}

/** Short table of clan war totals for the Weekly History page. */
export function WarTotalsHistory() {
  const t = useT();
  const { results } = useWarResults();
  if (!results?.length) return null;
  return <section className="panel war-history">
    <div className="table-section-heading"><div><h2>{t("Clan war totals")}</h2><p>{t("Final clan scores from each war.")}</p></div>
      <Link className="text-link" href="/war-results">{t("War Results")}</Link></div>
    <div className="table-scroll"><table className="resource-table">
      <thead><tr><th>{t("War")}</th><th>{t("Clan total")}</th><th>{t("Change")}</th><th>{t("Top scorer")}</th></tr></thead>
      <tbody>{results.map((result, index) => {
        const previous = results.slice(index + 1).find((item) => item.clanTotal !== null);
        const change = result.clanTotal !== null && previous?.clanTotal != null ? result.clanTotal - previous.clanTotal : null;
        const top = result.points[0];
        return <tr key={result.id}>
          <td><strong>{result.label || t("Week of {date}", { date: formatWeek(result.week) })}</strong></td>
          <td>{result.clanTotal === null ? "—" : numberFormat(result.clanTotal)}</td>
          <td className={change === null || change === 0 ? "" : change > 0 ? "movement-up" : "movement-down"}>{change === null ? "—" : `${change > 0 ? "+" : ""}${numberFormat(change)}`}</td>
          <td>{top ? `${top.gameName} · ${numberFormat(top.points)}` : "—"}</td>
        </tr>;
      })}</tbody>
    </table></div>
  </section>;
}
