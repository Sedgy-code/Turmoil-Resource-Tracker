"use client";

import { numberFormat } from "@/lib/resources";
import { useT } from "@/lib/i18n";
import { currentWeek } from "@/lib/resources";
import type { Member, WarResult } from "@/lib/types";
import { MemberAvatar, MemberName } from "./member-identity";
import { VialIcon } from "./resource-icons";
import { useSortable } from "./sortable";
import { useStackFold } from "./stack-fold";

type Row = { key: string; member?: Member; name: string; values: (number | null)[]; total: number };

/**
 * Clan Tech Race: what each member donated between one vial upload and the next, this week.
 * A clan is knocked out of the race every day, so a member who hasn't donated since the last
 * check is highlighted.
 */
export function VialDaily({ results, byId, meId, admin = false }: { results: WarResult[]; byId: Map<string, Member>; meId?: string; admin?: boolean }) {
  const t = useT();
  const week = currentWeek();
  const uploads = results.filter((result) => result.week === week && result.points.length > 0).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const keyOf = (point: WarResult["points"][number]) => point.memberId ?? `name:${point.gameName.toLowerCase()}`;
  const rowMap = new Map<string, Row>();
  uploads.forEach((upload, column) => {
    for (const point of upload.points) {
      const key = keyOf(point);
      const member = point.memberId ? byId.get(point.memberId) : undefined;
      const row = rowMap.get(key) ?? { key, member, name: member?.username ?? point.gameName, values: uploads.map(() => null), total: 0 };
      row.values[column] = point.points;
      rowMap.set(key, row);
    }
  });
  // Turn running totals into "donated since the upload before".
  const rows = [...rowMap.values()].map((row) => {
    let previous: number | null = null;
    const deltas = row.values.map((value) => {
      if (value === null) return null;
      const delta = previous === null || value < previous ? value : value - previous;
      previous = value;
      return delta;
    });
    return { ...row, total: previous ?? 0, deltas };
  });
  const { sorted, header } = useSortable(rows, {
    member: (row) => row.name,
    total: (row) => row.total,
    latest: (row) => row.deltas[row.deltas.length - 1] ?? -1,
  }, { key: "latest", direction: "asc" });
  // On a phone each member is one line (this week's vials) until tapped; yours starts open.
  const fold = useStackFold(meId);
  if (!uploads.length) return null;
  // Your own row first.
  const mine = (row: (typeof sorted)[number]) => !!meId && row.member?.id === meId;
  const shown = [...sorted.filter(mine), ...sorted.filter((row) => !mine(row))];
  const label = (iso: string) => new Date(iso).toLocaleDateString(undefined, { weekday: "short", day: "numeric", timeZone: "UTC" });
  const quiet = rows.filter((row) => uploads.length > 1 && (row.deltas[row.deltas.length - 1] ?? 0) === 0).length;
  return <section className="panel war-card vial-daily">
    <header>
      <div>
        <h2>{t("Clan Tech Race: donations this week")}</h2>
        <p>{admin ? t("Upload the donation screenshot once a day. Each column shows what members gave since the upload before. Clans are knocked out daily at 00:00 UTC.") : t("What members donated each day, from the daily screenshot. Clans are knocked out daily at 00:00 UTC.")}</p>
      </div>
      {uploads.length > 1 && <div className="war-card-total"><span>{t("No donation since the last upload")}</span><strong>{quiet}</strong></div>}
    </header>
    <div className="table-scroll tone-teal"><table className="resource-table war-table stack-table">
      <thead><tr>
        {header("member", t("Member"))}
        {uploads.map((upload, index) => index === uploads.length - 1 ? header("latest", label(upload.createdAt)) : <th key={upload.id}>{label(upload.createdAt)}</th>)}
        {header("total", t("This week"), { icon: <VialIcon size={20} /> })}
      </tr></thead>
      <tbody>{shown.map((row) => <tr key={row.key} {...fold.row(row.member?.id ?? row.key, mine(row) ? "row-me" : undefined)}>
        <td className="stack-title">{row.member
          ? <div className="table-member"><MemberAvatar member={row.member} small /><strong><MemberName member={row.member} /></strong>{mine(row) && <span className="you-badge">{t("you")}</span>}</div>
          : <span className="war-guest">{row.name}</span>}
          {uploads.length > 1 && row.deltas[row.deltas.length - 1] === 0 && <small className="stack-folded-only vial-quiet-note">{t("No donation since the last upload")}</small>}</td>
        {row.deltas.map((delta, index) => <td key={index} data-label={label(uploads[index].createdAt)} className={delta === 0 && index > 0 ? "vial-zero" : undefined}>{delta === null ? "—" : `${index > 0 ? "+" : ""}${numberFormat(delta)}`}</td>)}
        <td className="war-points stack-key" data-label={t("This week")}>{numberFormat(row.total)}</td>
        {fold.toggleCell(row.member?.id ?? row.key)}
      </tr>)}</tbody>
    </table></div>
  </section>;
}
