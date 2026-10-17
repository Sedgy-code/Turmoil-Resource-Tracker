"use client";

import Link from "next/link";
import { Settings2 } from "lucide-react";
import "./member-history.css";

/** Leadership → Settings: where each clan setting lives. */
export function LeadershipSettings() {
  return <div className="hoard-page">
    <section className="panel settings-block">
      <h2><Settings2 size={16} />Clan settings</h2>
      <ul className="settings-links">
        <li><Link href="/war-points">War point rates</Link> — on the Points Calculator page (Edit rates).</li>
        <li><Link href="/hoarding-watch">Saver vs hoarder rules</Link> — on the Hoarding page.</li>
        <li><Link href="/members">Clan capacity, strikes and holidays</Link> — on the Members page.</li>
      </ul>
    </section>
  </div>;
}
