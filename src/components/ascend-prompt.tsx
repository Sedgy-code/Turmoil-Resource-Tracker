"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, ChevronsUp } from "lucide-react";
import { ASCENSION_PILLARS, ASCENSIONS_UPDATED, PILLAR_LABELS } from "@/lib/ascension";
import { useT } from "@/lib/i18n";
import { ascendCheck, SPEND_RESOURCES } from "@/lib/spending-order";
import type { AscendCheck, AscensionPillar, AscensionsResponse, ResourceEntry } from "@/lib/types";
import { AscendWarning } from "./home-week";
import { PILLAR_ICONS } from "./resource-icons";
import "./home-week.css";

async function send<T>(url: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, cache: "no-store", ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((result as { error?: string }).error || "Please try again.");
  return result as T;
}

/**
 * My Resources: when your saved resources are enough to ascend a pillar (the official guide, as on the
 * Spending Order), it says so and asks whether you plan to this week. The same answer as on Home.
 */
export function AscendPrompt({ entry, notify }: { entry: ResourceEntry | undefined; notify: (message: string, error?: boolean) => void }) {
  const t = useT();
  const [mine, setMine] = useState<AscensionPillar[] | null | undefined>(undefined);
  const [warning, setWarning] = useState<{ pillar: AscensionPillar; next: AscensionPillar[]; check: AscendCheck } | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => { send<AscensionsResponse>("/api/ascensions").then((result) => { if (live) setMine(result.mine); }).catch(() => undefined); };
    load();
    window.addEventListener(ASCENSIONS_UPDATED, load);
    return () => { live = false; window.removeEventListener(ASCENSIONS_UPDATED, load); };
  }, []);
  const ready = SPEND_RESOURCES.map((resource) => ({ resource, check: ascendCheck(resource, entry) }))
    .filter((item): item is { resource: typeof item.resource; check: Extract<AscendCheck, { state: "ready" }> } => item.check.state === "ready");
  // Nothing to flag until the answer has loaded and at least one pillar is ready.
  if (mine === undefined || !ready.length) return null;

  const answered = mine !== null;
  const title = !answered
    ? t("Planning to ascend (or push the new tiers) this week?")
    : mine.length
      ? t("Planning to ascend: {what}", { what: mine.map((pillar) => t(PILLAR_LABELS[pillar])).join(", ") })
      : t("Not ascending this week");
  async function save(next: AscensionPillar[]) {
    const before = mine;
    setMine(next);
    try {
      setMine((await send<AscensionsResponse>("/api/ascensions", "PUT", { pillars: next })).mine);
      window.dispatchEvent(new Event(ASCENSIONS_UPDATED));
      notify(t("Answer saved."));
    } catch (error) {
      setMine(before);
      notify(t(error instanceof Error ? error.message : "Please try again."), true);
    }
  }
  /** Ticking a pillar you don't look ready for asks first, as on Home. */
  function choose(pillar: AscensionPillar) {
    const current = mine ?? [];
    const next = current.includes(pillar) ? current.filter((item) => item !== pillar) : [...current, pillar];
    const resource = SPEND_RESOURCES.find((item) => item === pillar);
    if (resource && !current.includes(pillar)) {
      const check = ascendCheck(resource, entry);
      if (check.state === "short" || check.state === "level") {
        setWarning({ pillar, next, check });
        return;
      }
    }
    setWarning(null);
    void save(next);
  }

  return <section className="panel ascend-prompt" aria-labelledby="ascend-prompt-title">
    <h2 id="ascend-prompt-title"><ChevronsUp size={20} aria-hidden="true" />{t("You can ascend: {what}", { what: ready.map(({ resource }) => t(PILLAR_LABELS[resource])).join(", ") })}</h2>
    <ul className="ascend-prompt-ready">{ready.map(({ resource, check }) => {
      const Picture = PILLAR_ICONS[resource];
      return <li key={resource}><Picture size={20} /><span><b>{t(PILLAR_LABELS[resource])}</b> · {t("Enough for {rarity}.", { rarity: t(check.reaches) })}</span></li>;
    })}</ul>
    <div className="ascend-prompt-question">
      <strong>{title}</strong>
      {!answered && <small>{t("Tap what you plan to ascend, or No.")}</small>}
      {answered && mine.length > 0 && <small>{t("Check your place on the Spending Order before you push.")} <Link className="home-link" href="/spending-order">{t("Spending Order")}<ArrowRight size={14} aria-hidden="true" /></Link></small>}
    </div>
    <div className="home-chips" role="group" aria-label={t("Planning to ascend (or push the new tiers) this week?")}>
      <button type="button" aria-pressed={answered && mine.length === 0} onClick={() => { setWarning(null); void save([]); }}><span>{t("No")}</span></button>
      {ASCENSION_PILLARS.map((pillar) => {
        const Icon = PILLAR_ICONS[pillar];
        return <button type="button" key={pillar} aria-pressed={!!mine?.includes(pillar) || warning?.pillar === pillar} onClick={() => choose(pillar)}>
          <Icon size={24} /><span>{t(PILLAR_LABELS[pillar])}</span>
        </button>;
      })}
    </div>
    {warning && <AscendWarning pillar={warning.pillar} check={warning.check} onCancel={() => setWarning(null)} onConfirm={() => { const next = warning.next; setWarning(null); void save(next); }} />}
  </section>;
}
