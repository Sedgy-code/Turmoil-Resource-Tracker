"use client";

import { useId, useState } from "react";
import { ChevronDown, ImageIcon } from "lucide-react";
import { useT } from "@/lib/i18n";

/** In-game screenshots showing where each number is found. */
export const FIELD_PICTURES = {
  skillTickets: "/guide/skill-tickets.webp",
  fiveSkills: "/guide/skill-cost.webp",
  skillLevel: "/guide/skill-level.webp",
  mountKeys: "/guide/mount-keys.webp",
  mount: "/guide/mount-cost.webp",
  mountLevel: "/guide/mount-level.webp",
  extraMountChancePercent: "/guide/extra-mount.webp",
  eggshellsTotal: "/guide/eggshells.webp",
  eggLevel: "/guide/pet-level.webp",
  extraPetSummonPercent: "/guide/extra-pet.webp",
  hammers: "/guide/hammers.webp",
  eggsPetsTotal: "/guide/eggs-pets.webp",
  mountsToMerge: "/guide/mounts-merge.webp",
  potions: "/guide/potions.webp",
} as const;
export type GuidedField = keyof typeof FIELD_PICTURES;

/** "Where do I find this?" — opens a picture of the game screen with the number boxed in gold. */
export function FieldGuide({ field, hint, label }: { field: GuidedField; hint: string; label?: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="field-guide">
      <button
        type="button"
        className="field-guide-toggle"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        <ImageIcon size={13} aria-hidden="true" />
        {label ?? t("Where do I find this?")}
        <ChevronDown size={13} aria-hidden="true" className={open ? "open" : undefined} />
      </button>
      {open && (
        <div className="field-guide-panel" id={id}>
          <p>{hint}</p>
          {/* eslint-disable-next-line @next/next/no-img-element -- small static screenshots */}
          <img src={FIELD_PICTURES[field]} alt={hint} loading="lazy" decoding="async" />
        </div>
      )}
    </div>
  );
}
