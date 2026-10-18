"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { useT } from "@/lib/i18n";

function stored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null; // storage blocked: use the default
  }
}

/**
 * Whether a Home card is open, remembered on this phone. A card that needs an answer can't fold
 * until the member has given it (canFold false). `folded` is how it starts when nothing is
 * remembered yet. Put the week in the id for cards that need an answer each week.
 */
export function useFold(id: string, { canFold = true, folded = false }: { canFold?: boolean; folded?: boolean } = {}) {
  const key = `turmoil-fold:${id}`;
  const [choice, setChoice] = useState(() => ({ key, value: stored(key) }));
  const value = choice.key === key ? choice.value : stored(key);
  const open = !canFold || (value ? value === "open" : !folded);
  const toggle = () => {
    const next = open ? "closed" : "open";
    setChoice({ key, value: next });
    try { window.localStorage.setItem(key, next); } catch { /* private mode: this visit only */ }
  };
  return { open, canFold, toggle };
}

/** The ⌄ button at the end of a Home card's heading. */
export function FoldButton({ open, onClick, label, controls }: { open: boolean; onClick: () => void; label: string; controls?: string }) {
  const t = useT();
  return (
    <button
      type="button"
      className={`home-fold${open ? " open" : ""}`}
      aria-expanded={open}
      aria-controls={controls}
      aria-label={`${open ? t("Hide") : t("Show")}: ${label}`}
      onClick={onClick}
    >
      <ChevronDown size={18} aria-hidden="true" />
    </button>
  );
}
