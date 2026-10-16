"use client";

import { useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

export type SortDirection = "asc" | "desc";
export type SortState<K extends string> = { key: K; direction: SortDirection };
type SortValue = string | number | null | undefined;

/**
 * Click-to-sort for any table: press a column heading to sort by it, press again to reverse.
 * Text sorts A–Z first; numbers and dates sort biggest/newest first.
 */
export function useSortable<T, K extends string>(
  rows: T[],
  getters: Record<K, (row: T) => SortValue>,
  initial: SortState<NoInfer<K>>,
) {
  const [sort, setSort] = useState<SortState<K>>(initial);
  const sorted = [...rows].sort((a, b) => {
    const av = getters[sort.key](a);
    const bv = getters[sort.key](b);
    // Empty values always go to the bottom.
    if (av === null || av === undefined || av === "") return bv === null || bv === undefined || bv === "" ? 0 : 1;
    if (bv === null || bv === undefined || bv === "") return -1;
    const difference = typeof av === "string" && typeof bv === "string"
      ? av.localeCompare(bv, undefined, { sensitivity: "base", numeric: true })
      : Number(av) - Number(bv);
    return difference * (sort.direction === "asc" ? 1 : -1);
  });
  const toggle = (key: K) => setSort((old) => {
    if (old.key === key) return { key, direction: old.direction === "asc" ? "desc" : "asc" };
    const sample = rows.map((row) => getters[key](row)).find((value) => value !== null && value !== undefined && value !== "");
    return { key, direction: typeof sample === "string" ? "asc" : "desc" };
  });
  const header = (key: K, label: ReactNode, props: { className?: string; icon?: ReactNode } = {}) => (
    <th key={key} className={props.className} aria-sort={sort.key === key ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" className="column-sort" onClick={() => toggle(key)}>
        {props.icon}{label}
        {sort.key !== key ? <ArrowUpDown size={12} aria-hidden="true" /> : sort.direction === "asc" ? <ArrowUp size={12} aria-hidden="true" /> : <ArrowDown size={12} aria-hidden="true" />}
      </button>
    </th>
  );
  return { sorted, sort, setSort, header };
}
