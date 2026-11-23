"use client";

import { warDay } from "@/lib/war-calendar";
import { NextWarVote } from "./next-war-vote";
import { useClanDayVotes, useNow } from "./war-week";

/**
 * On Days 6–7, while voting is open, the vote for the next war's clan days sits on My Resources too:
 * many members only come in to update their resources, so this is where to catch their vote.
 */
export function ResourcesVote({ memberId, notify }: { memberId: string; notify: (message: string, error?: boolean) => void }) {
  const now = useNow();
  const war = warDay(now);
  const { votes, vote } = useClanDayVotes(war.day >= 6);
  if (!votes?.open) return null;
  return <div style={{ marginBottom: 14 }}><NextWarVote votes={votes} vote={vote} weekEnd={war.weekEnd} now={now} notify={notify} memberId={memberId} /></div>;
}
