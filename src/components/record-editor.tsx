"use client";

import { useMemo, useRef, useState } from "react";
import { ImagePlus, LoaderCircle, Pencil, Plus, ScanText, Trash2, Trophy, X } from "lucide-react";
import { currentWeek, formatWeek } from "@/lib/resources";
import { useT } from "@/lib/i18n";
import type { Member, WarReading, WarResult } from "@/lib/types";
import { warWeekOf } from "@/lib/war-calendar";
import { mergeReadings, newRow, readGroups, type DraftRow } from "@/lib/war-records";
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

export async function request<T>(url: string, options?: RequestInit): Promise<T> {
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

export type RecordKind = "war" | "vials" | "warday";
/** Wording for each kind of record; the screenshot flow is the same. */
export const TEXT = {
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
  // One war day's points, from the clan war screen (the list resets every war day).
  warday: {
    add: "Add daily war points", step1: "Add the clan war screenshot for this day (each member’s points for the day).",
    total: "Clan total", points: "Points", saved: "Daily war points saved.", deleted: "Upload deleted.",
    confirmDelete: "Delete this day’s upload? This can’t be undone.", save: "Save daily points",
    empty: "No war results yet. An admin can add them from the end-of-war screenshots.", chart: "Clan total over time",
    history: "Clan war totals", historySub: "Final clan scores from each war.", link: "War Results", top: "Top scorer",
    labelExample: "e.g. Season 30 · War 4", date: "War date", column: "War",
  },
} as const;
/** Add a new record from screenshots, or fix a saved one: change numbers, add missing players, add screenshots. */
export function RecordEditor({ kind, members, existing, warDay, week, onSaved, onClose, notify }: {
  kind: RecordKind;
  /** Daily uploads only: the war day (1–5) and war (Monday before Day 1) the points belong to. */
  warDay?: number;
  week?: string;
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
            week: kind === "warday" ? week ?? warWeekOf(new Date())
              : kind === "war" ? warWeekOf(new Date(`${date}T12:00:00Z`)) : currentWeek(new Date(`${date}T12:00:00Z`)),
            ...(kind === "warday" ? { warDay } : {}),
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
      <h2>{existing ? <Pencil size={17} /> : <Trophy size={17} />}{kind === "warday"
        ? `${existing ? t("Edit") : t(words.add)}: ${t("Day {day}", { day: existing?.warDay ?? warDay ?? 1 })}`
        : existing ? `${t("Edit")}: ${existing.label || t("Week of {date}", { date: formatWeek(existing.week) })}` : t(words.add)}</h2>
      <button className="icon-button" aria-label={t("Close")} onClick={onClose}><X size={17} /></button>
    </div>
    {!existing && <ol className="war-steps">
      <li>{t(words.step1)}</li>
      <li>{t("Press “Read screenshots”. The site fills in the table for you.")}</li>
      <li>{t("Check the numbers, fix anything wrong, then press Save.")}</li>
    </ol>}
    {kind !== "warday" && <div className="war-form-grid">
      {!existing && <label><span>{t(words.date)}</span><input type="date" value={date} onChange={(event) => event.target.value && setDate(event.target.value)} /></label>}
      <label><span>{t("Name (optional)")}</span><input value={label} maxLength={120} placeholder={t(words.labelExample)} onChange={(event) => setLabel(event.target.value)} /></label>
    </div>}
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
