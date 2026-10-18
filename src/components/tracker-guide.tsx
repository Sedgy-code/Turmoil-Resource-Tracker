"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowRight, Check, LogIn, Save } from "lucide-react";
import { ClanBrand } from "./clan-brand";
import { LanguagePicker } from "./language-picker";
import { FIELD_PICTURES, type GuidedField } from "./field-guide";
import { RESOURCE_ICONS } from "./resource-icons";
import type { ResourceKey } from "@/lib/resources";
import { LANGUAGES, LanguageProvider, useLanguage, type Language } from "@/lib/i18n";

/** The 13 boxes on My Resources, grouped by the game screen they come from. */
const SECTIONS: { screen: string; fields: { field: GuidedField; label: string; where: string }[] }[] = [
  {
    screen: "Skills screen",
    fields: [
      { field: "skillTickets", label: "Skill Tickets", where: "Skills screen → the green ticket number at the top left." },
      { field: "fiveSkills", label: "Skill summon cost (×5)", where: "Skills screen → the number on the blue “Summon x5” button." },
      { field: "skillLevel", label: "Skill level", where: "Skills screen → tap ⓘ next to Summon. Use the Level number at the top." },
    ],
  },
  {
    screen: "Mounts screen",
    fields: [
      { field: "mountKeys", label: "Mount Keys", where: "Mounts screen → the key number at the top." },
      { field: "mount", label: "Mount summon cost (×1)", where: "Mounts screen → the number on the blue “Summon x1” button." },
      { field: "mountLevel", label: "Mount level", where: "Mounts screen → tap ⓘ next to Summon. Use the Level number at the top." },
      { field: "mountsToMerge", label: "Mounts to Merge", where: "Tap a mount → Upgrade → select all spare mounts → use the “Selected” number." },
    ],
  },
  {
    screen: "Pets screen",
    fields: [
      { field: "eggshellsTotal", label: "Eggshells total", where: "Pets screen → the eggshell number at the top left." },
      { field: "eggLevel", label: "Egg/pet level", where: "Pets screen → tap ⓘ next to Summon. Use the Level number at the top." },
      { field: "eggsPetsTotal", label: "Total eggs/pets", where: "Tap a pet → Upgrade → select all spare eggs/pets → use the “Selected” number." },
    ],
  },
  {
    screen: "Tech Tree",
    fields: [
      { field: "potions", label: "Clan Tech Vials", where: "Tech Tree screen → the green vial number, under the red potion at the top left." },
      { field: "extraMountChancePercent", label: "Extra mount chance %", where: "Tech Tree → tap ⓘ to open Total Bonuses → “Chance to summon an extra mount”." },
      { field: "extraPetSummonPercent", label: "Extra pet summon %", where: "Tech Tree → tap ⓘ to open Total Bonuses → “Chance to summon an extra egg”." },
    ],
  },
  {
    screen: "Forge screen",
    fields: [
      { field: "hammers", label: "Hammers", where: "Forge screen → the hammer number on the anvil." },
    ],
  },
];

function GuideContent() {
  const { t, setLanguage } = useLanguage();
  const params = useSearchParams();
  const requested = params.get("lang");
  // Discord buttons open this page with ?lang=ko etc.; that choice is remembered.
  useEffect(() => {
    if (LANGUAGES.some(({ code }) => code === requested)) setLanguage(requested as Language);
  }, [requested, setLanguage]);
  let number = 0;
  return (
    <main className="guide-page">
      <header className="guide-header">
        <Link href="/" className="guide-brand">
          <ClanBrand decorative size={34} />
          <strong>TURMOIL</strong>
        </Link>
        <LanguagePicker />
      </header>
      <section className="guide-intro">
        <span className="eyebrow">TURMOIL CLAN HUB</span>
        <h1>{t("Tracker guide")}</h1>
        <p>{t("Update your resources once a week. It takes about 2 minutes.")}</p>
        <ol className="guide-steps">
          <li><LogIn size={18} aria-hidden="true" /><span>{t("Open the tracker and sign in with Discord. On a phone, tap ⋯ and choose “Open in browser” so you stay signed in.")}</span></li>
          <li><Check size={18} aria-hidden="true" /><span>{t("Open My Resources and copy each number from the game. The pictures below show where each one is.")}</span></li>
          <li><Save size={18} aria-hidden="true" /><span>{t("Press Save. A complete save earns 20 Clan Points each week. Enter 0 if you have none.")}</span></li>
        </ol>
        <Link href="/resources" className="button primary guide-open">
          {t("Open the tracker")}
          <ArrowRight size={16} aria-hidden="true" />
        </Link>
      </section>
      {SECTIONS.map(({ screen, fields }) => (
        <section className="guide-section" key={screen}>
          <h2>{t(screen)}</h2>
          <div className="guide-cards">
            {fields.map(({ field, label, where }) => {
              number += 1;
              return (
                <article className="guide-card" key={field}>
                  <h3><span className="guide-number">{number}</span>{field in RESOURCE_ICONS && (() => { const Picture = RESOURCE_ICONS[field as ResourceKey]; return <Picture size={24} />; })()}{t(label)}</h3>
                  <p>{t(where)}</p>
                  {/* eslint-disable-next-line @next/next/no-img-element -- small static screenshots */}
                  <img src={FIELD_PICTURES[field]} alt={t(where)} loading="lazy" decoding="async" />
                </article>
              );
            })}
          </div>
        </section>
      ))}
      <footer className="guide-footer">
        <p>{t("Stuck? Ask in clan-chat on Discord.")}</p>
        <Link href="/resources" className="button primary">
          {t("Open the tracker")}
          <ArrowRight size={16} aria-hidden="true" />
        </Link>
      </footer>
    </main>
  );
}

/** Public picture guide (no sign-in needed), shown in the reader's chosen language. */
export function TrackerGuide() {
  return (
    <LanguageProvider>
      <GuideContent />
    </LanguageProvider>
  );
}
