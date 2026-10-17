import type { WarReading } from "./types";

/** One editable row of a war or vial record, as the admin sees it before saving. */
export type DraftRow = { key: string; gameName: string; memberId: string; points: string };

let rowCounter = 0;
export const newRow = (row?: Partial<DraftRow>): DraftRow => ({ key: `row-${++rowCounter}`, gameName: "", memberId: "", points: "", ...row });

/** Lower-case letters and digits only, so "Lone Wolf" and "lonewolf" match. */
export function nameKey(name: string): string {
  return name.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

/**
 * Splits screenshots into small groups to read, keeping their order (overlapping neighbours stay
 * together), so each request stays well under the site's upload size limit.
 */
export function readGroups<T extends { data: string }>(shots: T[], perGroup = 2, maxChars = 3_000_000): T[][] {
  const groups: T[][] = [];
  for (const shot of shots) {
    const last = groups[groups.length - 1];
    const size = last?.reduce((total, item) => total + item.data.length, 0) ?? 0;
    if (last && last.length < perGroup && size + shot.data.length <= maxChars) last.push(shot);
    else groups.push([shot]);
  }
  return groups;
}

/**
 * Adds what the reader found to the table. New players become rows; a player already in the table
 * (seen again in an overlapping screenshot, or typed in by hand) only gets a number or member it was
 * missing, never a changed number.
 */
export function mergeReadings(current: DraftRow[], readings: WarReading[]): { rows: DraftRow[]; added: number } {
  const rows = current.map((row) => ({ ...row }));
  const byName = new Map(rows.filter((row) => nameKey(row.gameName)).map((row) => [nameKey(row.gameName), row]));
  const byMember = new Map(rows.filter((row) => row.memberId).map((row) => [row.memberId, row]));
  let added = 0;
  for (const reading of readings) {
    for (const found of reading.rows) {
      const key = nameKey(found.gameName);
      const same = (key ? byName.get(key) : undefined) ?? (found.memberId ? byMember.get(found.memberId) : undefined);
      if (same) {
        if (!same.points && found.points !== null) same.points = String(found.points);
        if (!same.memberId && found.memberId) { same.memberId = found.memberId; byMember.set(found.memberId, same); }
        continue;
      }
      const row = newRow({ gameName: found.gameName, memberId: found.memberId ?? "", points: found.points === null ? "" : String(found.points) });
      rows.push(row);
      if (key) byName.set(key, row);
      if (row.memberId) byMember.set(row.memberId, row);
      added++;
    }
  }
  return { rows, added };
}
