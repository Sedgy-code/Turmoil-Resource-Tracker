"use client";

import Link from "next/link";
import { Settings2 } from "lucide-react";
import { useT } from "@/lib/i18n";
import "./member-history.css";

/** Leadership → Settings: where each clan setting lives. */
export function LeadershipSettings() {
  const t = useT();
  return <div className="hoard-page">
    <section className="panel settings-block">
      <h2><Settings2 size={16} />{t("Clan settings")}</h2>
      <ul className="settings-links">
        <li><Link href="/war-points">{t("War point rates")}</Link> — {t("on the Points Calculator page (Edit rates).")}</li>
        <li><Link href="/hoarding-watch">{t("Saver vs hoarder rules")}</Link> — {t("on the Hoarding page.")}</li>
        <li><Link href="/members">{t("Clan capacity, strikes and holidays")}</Link> — {t("on the Members page.")}</li>
      </ul>
    </section>
  </div>;
}
