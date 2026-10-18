"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ExternalLink, LoaderCircle, Minus, Plus, RotateCcw, Save } from "lucide-react";
import { VialIcon } from "./resource-icons";
import { TECH_NODES, TECH_SECTIONS, nextToFund, progress } from "@/lib/clan-tech";
import { useT } from "@/lib/i18n";
import "./clan-tech.css";

type Data = { levels: Record<string, number>; updatedAt: string | null; canEdit: boolean };
const TIER_LABEL = { 1: "War points", 2: "War battle", 3: "Tech race", 4: "War rewards", 5: "Later" } as const;

async function request<T>(init?: RequestInit): Promise<T> {
  const response = await fetch("/api/clan-tech", { cache: "no-store", ...init, headers: { "Content-Type": "application/json" } });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "Something went wrong. Please try again.");
  return result as T;
}

/** Records → Clan Tech: how far the tree is and what the clan funds next. */
export function ClanTech({ notify }: { notify: (message: string, error?: boolean) => void }) {
  const t = useT();
  const [data, setData] = useState<Data | null>(null);
  const [draft, setDraft] = useState<Record<string, number>>({});
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const load = useCallback(async () => {
    try { const result = await request<Data>(); setData(result); setDraft(result.levels); setError(""); }
    catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const changed = useMemo(() => Object.fromEntries(TECH_NODES.filter((entry) => (draft[entry.key] ?? 0) !== (data?.levels[entry.key] ?? 0)).map((entry) => [entry.key, draft[entry.key] ?? 0])), [draft, data]);
  const dirty = Object.keys(changed).length > 0;
  async function save(body: unknown, done: string) {
    setSaving(true);
    try { const result = await request<Data>({ method: "PUT", body: JSON.stringify(body) }); setData(result); setDraft(result.levels); notify(t(done)); }
    catch (e) { notify(t((e as Error).message), true); }
    finally { setSaving(false); }
  }
  if (!data) return <section className="panel war-empty">{error ? <><p>{t(error)}</p><button className="button primary" onClick={() => void load()}>{t("Try again")}</button></> : <LoaderCircle size={22} className="spin" />}</section>;
  const levels = draft;
  const next = nextToFund(levels);
  const set = (key: string, max: number, value: number) => setDraft({ ...draft, [key]: Math.max(0, Math.min(max, value)) });
  return <div className="tech-page">
    <section className="panel tech-summary">
      <div className="tech-overall">
        <VialIcon size={30} />
        <div>
          <span>{t("Tree complete")}</span>
          <strong>{Math.round(progress(levels) * 1000) / 10}%</strong>
          <small>{data.updatedAt ? t("Updated {date}", { date: new Date(data.updatedAt).toLocaleDateString() }) : t("Not filled in yet")}</small>
        </div>
      </div>
      <div className="tech-next">
        <h2>{t("Fund next")}</h2>
        {next.length ? <ol>{next.map((entry) => <li key={entry.key}><b>{t(entry.name)}</b><span>{levels[entry.key] ?? 0}/{entry.max} · {t(TIER_LABEL[entry.priority])}</span></li>)}</ol> : <p>{t("Everything is maxed!")}</p>}
      </div>
    </section>
    <p className="war-week-note">{t("Order: war points first, then Clan War damage and health, then tech race boosts, then war rewards. The tree resets each season.")} <a href="https://1vcian.me/fm/#/clan" target="_blank" rel="noreferrer">{t("Plan your own tree")} <ExternalLink size={12} /></a></p>
    {data.canEdit && <div className="tech-admin">
      <span>{t("Copy the levels from the in-game Tech Tree screen, then press Save.")}</span>
      <button className="button primary" disabled={!dirty || saving} onClick={() => void save({ levels: changed }, "Clan Tech saved.")}>{saving ? <LoaderCircle size={15} className="spin" /> : <Save size={15} />}{t("Save")}</button>
      <button className="button subtle" disabled={saving} onClick={() => window.confirm(t("Set every node back to 0 for a new season?")) && void save({ reset: true }, "Clan Tech reset for the new season.")}><RotateCcw size={15} />{t("New season")}</button>
    </div>}
    <div className="tech-sections">{TECH_SECTIONS.map((section) => {
      const nodes = TECH_NODES.filter((entry) => entry.section === section);
      return <section key={section} className="panel tech-section">
        <header><h2>{t(section)}</h2><span>{Math.round(progress(levels, nodes) * 100)}%</span></header>
        <ul>{nodes.map((entry) => {
          const level = levels[entry.key] ?? 0;
          return <li key={entry.key} className={level >= entry.max ? "tech-maxed" : entry.priority <= 3 ? "tech-priority" : undefined}>
            <div className="tech-name"><strong>{t(entry.name)}</strong><small>{t(entry.effect)}</small></div>
            {data.canEdit ? <div className="tech-edit">
              <button className="icon-button" aria-label={t("Lower")} onClick={() => set(entry.key, entry.max, level - 1)}><Minus size={13} /></button>
              <input inputMode="numeric" aria-label={t(entry.name)} value={level} onChange={(event) => set(entry.key, entry.max, Number(event.target.value.replace(/\D/g, "")) || 0)} />
              <button className="icon-button" aria-label={t("Raise")} onClick={() => set(entry.key, entry.max, level + 1)}><Plus size={13} /></button>
              <span>/{entry.max}</span>
            </div> : <span className="tech-level">{level >= entry.max ? t("Max") : `${level}/${entry.max}`}</span>}
            <i className="tech-bar"><b style={{ width: `${(level / entry.max) * 100}%` }} /></i>
          </li>;
        })}</ul>
      </section>;
    })}</div>
  </div>;
}
