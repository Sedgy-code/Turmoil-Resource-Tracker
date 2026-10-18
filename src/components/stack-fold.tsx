"use client";

import { useState, useSyncExternalStore, type MouseEvent } from "react";
import { ChevronDown } from "lucide-react";
import { useT } from "@/lib/i18n";

/** The width where .stack-table rows turn into cards (stack-tables.css). */
const PHONE = "(max-width: 700px)";

function subscribe(onChange: () => void) {
  const query = window.matchMedia(PHONE);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** True on a phone-width screen. */
export function usePhoneWidth(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia(PHONE).matches, () => false);
}

/**
 * Long member lists on a phone: each card shows only its title and one key number (cells marked
 * .stack-key) until it's tapped open, so a 47-member list is a few screens long, not twenty.
 * `openFirst` (usually your own row) starts open; `openAll` shows every card in full (a search
 * with only a few matches). On wider screens nothing changes: the table shows every column.
 */
export function useStackFold(openFirst?: string | null, openAll = false) {
  const phone = usePhoneWidth();
  const [flipped, setFlipped] = useState<ReadonlySet<string>>(() => new Set());
  const folding = phone && !openAll;
  const isOpen = (key: string) => !folding || (key === openFirst) !== flipped.has(key);
  const toggle = (key: string) => setFlipped((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  /** Props for a row: whether it's folded, and a tap anywhere on the card opens or closes it. */
  const row = (key: string, className?: string) => folding ? {
    className: [className, isOpen(key) ? "open" : "folded"].filter(Boolean).join(" "),
    onClick: (event: MouseEvent<HTMLTableRowElement>) => {
      // Links, buttons and fields inside the card keep their own job.
      if ((event.target as Element).closest("a, button, input, select, textarea, label, summary")) return;
      toggle(key);
    },
  } : { className };
  /** The last cell of each row on a phone: the ⌄ button. */
  const toggleCell = (key: string) => folding ? <FoldCell open={isOpen(key)} onToggle={() => toggle(key)} /> : null;
  return { folding, isOpen, row, toggleCell };
}

function FoldCell({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const t = useT();
  return <td className="stack-toggle-cell">
    <button type="button" className="stack-toggle" aria-expanded={open} aria-label={t("Details")} onClick={onToggle}><ChevronDown size={18} aria-hidden="true" /></button>
  </td>;
}
