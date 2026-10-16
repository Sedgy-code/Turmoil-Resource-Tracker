"use client";

import { Medal } from "lucide-react";
import { AWARDS } from "@/lib/awards";
import { numberFormat } from "@/lib/resources";
import { useT } from "@/lib/i18n";
import type { Member } from "@/lib/types";
import { MemberName } from "./member-identity";
import { useRecognition } from "./recognition";

/** Home: last month's award winners. */
export function MonthlyAwardsPanel({ members }: { members: Member[] }) {
  const t = useT();
  const { data } = useRecognition();
  const awards = data?.awards;
  if (!awards?.items.length) return null;
  const byId = new Map(members.map((member) => [member.id, member]));
  const month = new Date(`${awards.month}-01T00:00:00Z`).toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
  return <section className="panel recognition-panel monthly-awards">
    <h2><Medal size={17} />{t("Awards for {month}", { month })}</h2>
    <ul>{awards.items.map((item) => {
      const award = AWARDS[item.award];
      const winners = item.memberIds.map((id) => byId.get(id)).filter((member): member is Member => !!member);
      return <li key={item.award}>
        <span className="monthly-award-emoji" aria-hidden="true">{award.emoji}</span>
        <div>
          <strong>{t(award.title)}</strong>
          <span className="monthly-award-winners">{winners.length > 6 ? t("{count} members", { count: winners.length }) : winners.map((member, index) => <span key={member.id}>{index > 0 && ", "}<MemberName member={member} /></span>)}</span>
          {item.award !== "saver" && <small>{numberFormat(item.value)} {t(award.unit)}</small>}
        </div>
      </li>;
    })}</ul>
  </section>;
}
