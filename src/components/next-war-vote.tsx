"use client";

import { useState } from "react";
import { CalendarDays } from "lucide-react";
import { announceClanPointsUpdate } from "@/lib/clan-points";
import { countdown, utcDateTime, WAR_DAYS } from "@/lib/war-calendar";
import type { ResourceKey } from "@/lib/resources";
import { useLanguage } from "@/lib/i18n";
import type { ClanDayVotes } from "@/lib/types";
import { FoldButton, useFold } from "./home-fold";
import { EggIcon, HammerIcon, HorseshoeIcon, TicketIcon, type ResourcePicture } from "./resource-icons";
import "./home-week.css";

/** What members spend on the spending days, as the same pictures as the ascending chips. */
type Need = "hammers" | "skills" | "mounts" | "eggs";
const NEEDS: readonly Need[] = ["hammers", "skills", "mounts", "eggs"];
const NEED_ICONS: Record<Need, ResourcePicture> = { hammers: HammerIcon, skills: TicketIcon, mounts: HorseshoeIcon, eggs: EggIcon };
const NEED_RESOURCES: Record<Need, readonly ResourceKey[]> = { hammers: ["hammers"], skills: ["skillTickets"], mounts: ["mountKeys", "mountsToMerge"], eggs: ["eggsPetsTotal", "eggshellsTotal"] };
/** The resources that score on a spending day (from the war calendar). */
function needsOf(day: number): Need[] {
  const resources = WAR_DAYS[day - 1].resources;
  return NEEDS.filter((need) => NEED_RESOURCES[need].some((key) => resources.includes(key)));
}

/**
 * The vote for next war's clan days (Days 6–7, until leadership picks), on Home and on the War page:
 * two taps, with what each day needs and when voting closes. `votes` and `vote` come from
 * useClanDayVotes, so the page that shows it owns the data.
 */
export function NextWarVote({ votes, vote, weekEnd, now, notify, memberId }: {
  votes: ClanDayVotes;
  vote: (days: number[]) => Promise<{ error: string | null; rewarded: boolean }>;
  /** When the next war starts: voting closes then, or sooner if leadership picks. */
  weekEnd: Date;
  now: Date;
  notify?: (message: string, error?: boolean) => void;
  memberId: string;
}) {
  const { t, language } = useLanguage();
  const [voting, setVoting] = useState(false);
  const mine = votes.mine ?? [];
  async function toggleVote(day: number) {
    // Day 6 is always fought, so a vote is the two other days to win.
    if (!mine.includes(day) && mine.length >= 2) {
      notify?.(t("You can pick 2 days. Tap one of yours to swap it."));
      return;
    }
    setVoting(true);
    const result = await vote(mine.includes(day) ? mine.filter((item) => item !== day) : [...mine, day]);
    setVoting(false);
    if (result.error) notify?.(t(result.error), true);
    else if (result.rewarded) {
      notify?.(t("Thanks for voting! +10 Clan Points."));
      announceClanPointsUpdate(memberId);
    }
  }
  // The vote can only fold once the member has voted; voted for both days before the page opened:
  // start folded, with the days they picked underneath.
  const [votedOnArrival] = useState(() => mine.length >= 2);
  const fold = useFold(`vote:${votes.week}`, { canFold: mine.length > 0, folded: votedOnArrival });
  const needName = (need: Need) => need === "hammers" ? t("Hammers") : need === "skills" ? t("Skills") : need === "mounts" ? t("Mounts") : t("Eggs and pets");
  const prompt = t("Pick 2 days to win next war (plus Day 6)");
  return <section className={`home-card home-next-war${fold.open ? "" : " folded"}`} aria-labelledby="home-next-war-title">
    <div className="home-card-head">
      <h2 id="home-next-war-title" className="home-kicker"><CalendarDays size={19} />{t("Next war starts in {time}", { time: countdown(weekEnd, now) })}</h2>
      {/* Before voting: the reward. After voting: the ⌄ to fold it away. */}
      {fold.canFold
        ? <FoldButton open={fold.open} onClick={fold.toggle} label={prompt} controls="home-next-war-body" />
        : <em className="home-vote-reward">{t("+10 points")}</em>}
    </div>
    {!fold.open && <p className="home-fold-summary">{t("Your vote: {days}", { days: mine.map((day) => t("Day {day}", { day })).join(" + ") })}</p>}
    {fold.open && <div id="home-next-war-body">
      <p className="home-today-main">{prompt}</p>
      <div className="home-vote-days" role="group" aria-label={prompt}>
        {[1, 2, 3, 4, 5].map((day) => <button key={day} aria-pressed={mine.includes(day)} disabled={voting} onClick={() => void toggleVote(day)}>
          <span>{t("Day {day}", { day })}</span>
          <span className="home-vote-needs">
            {needsOf(day).map((need) => { const Icon = NEED_ICONS[need]; return <Icon key={need} size={16} />; })}
            <span className="visually-hidden">{needsOf(day).map(needName).join(", ")}</span>
          </span>
          <strong>{votes.counts[day - 1]}</strong>
        </button>)}
      </div>
      <p className="home-vote-key" aria-hidden="true">{NEEDS.map((need) => { const Icon = NEED_ICONS[need]; return <span key={need}><Icon size={17} />{needName(need)}</span>; })}</p>
      <p className="home-vote-closes">{t("Voting closes {date}, in {time}, or sooner if leaders pick.", { date: utcDateTime(weekEnd.toISOString(), language), time: countdown(weekEnd, now) })}</p>
      <small className="home-vote-voters">{t("Members voted so far: {count}. Leadership makes the final pick.", { count: votes.voters })}</small>
    </div>}
  </section>;
}
