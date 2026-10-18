"use client";

import Link from "next/link";
import { ArrowRight, Crosshair, Trophy } from "lucide-react";
import { formatWeek, numberFormat } from "@/lib/resources";
import { useT } from "@/lib/i18n";
import type { Member } from "@/lib/types";
import { FoldButton, useFold } from "./home-fold";
import { MemberAvatar, MemberName } from "./member-identity";
import { useRecognition } from "./recognition";

const MEDALS = ["🥇", "🥈", "🥉"];

/** Dashboard boards: who joined the most snipes, and how the latest war went. */
export function SnipeChampions({ members }: { members: Member[] }) {
  const t = useT();
  const { data, ranking, placeOf } = useRecognition();
  // Both boards start folded on Home; each member opens them if they want.
  const snipeFold = useFold("snipe-champions", { folded: true });
  const warFold = useFold("latest-war", { folded: true });
  const byId = new Map(members.map((member) => [member.id, member]));
  const champions = ranking.filter((id) => byId.has(id)).slice(0, 5);
  const war = data?.latestWar;
  const topScorers = war ? Object.entries(war.points).filter(([id]) => byId.has(id)).sort((a, b) => b[1] - a[1]).slice(0, 3) : [];
  return (
    <div className="recognition-row">
      <section className={`panel recognition-panel snipe-champions${snipeFold.open ? "" : " folded"}`}>
        <div className="recognition-head">
          <h2><Crosshair size={17} />{t("Snipe Champions")}</h2>
          <FoldButton open={snipeFold.open} onClick={snipeFold.toggle} label={t("Snipe Champions")} controls="home-snipe-champions" />
        </div>
        {snipeFold.open && <div className="recognition-body" id="home-snipe-champions">
        <p className="recognition-sub">{t("Most snipes joined in the last 8 weeks. Thank you!")}</p>
        {champions.length ? <ol className="champion-list">
          {champions.map((id, index) => {
            const member = byId.get(id)!;
            return <li key={id} className={placeOf(id) === 0 ? "champion-top" : undefined}>
              <span className="champion-place">{MEDALS[placeOf(id)] ?? index + 1}</span>
              <MemberAvatar member={member} small />
              <strong><MemberName member={member} /></strong>
              <span className="champion-count">{t("{count} snipes", { count: data?.snipes.recent[id] ?? 0 })}</span>
            </li>;
          })}
        </ol> : <p className="recognition-empty">{t("No confirmed snipe attendance yet.")}</p>}
        <Link className="text-link recognition-link" href="/snipes">{t("Snipes")} <ArrowRight size={13} /></Link>
        </div>}
      </section>
      <section className={`panel recognition-panel latest-war${warFold.open ? "" : " folded"}`}>
        <div className="recognition-head">
          <h2><Trophy size={17} />{t("Latest war")}</h2>
          <FoldButton open={warFold.open} onClick={warFold.toggle} label={t("Latest war")} controls="home-latest-war" />
        </div>
        {warFold.open && <div className="recognition-body" id="home-latest-war">
        {war ? <>
          <p className="recognition-sub">{war.label || t("Week of {date}", { date: formatWeek(war.week) })}</p>
          <div className="latest-war-total"><span>{t("Clan total")}</span><strong>{war.clanTotal === null ? "—" : numberFormat(war.clanTotal)}</strong></div>
          {topScorers.length > 0 && <ol className="champion-list">
            {topScorers.map(([id, points], index) => {
              const member = byId.get(id)!;
              return <li key={id}>
                <span className="champion-place">{MEDALS[index]}</span>
                <MemberAvatar member={member} small />
                <strong><MemberName member={member} /></strong>
                <span className="champion-count">{numberFormat(points)}</span>
              </li>;
            })}
          </ol>}
        </> : <p className="recognition-empty">{t("No war results yet.")}</p>}
        <Link className="text-link recognition-link" href="/war-results">{t("War Results")} <ArrowRight size={13} /></Link>
        </div>}
      </section>
    </div>
  );
}
