"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { Crosshair } from "lucide-react";
import { useT } from "@/lib/i18n";
import type { RecognitionResponse } from "@/lib/types";

interface RecognitionContextValue {
  data: RecognitionResponse | null;
  reload: () => Promise<void>;
  /** Members ranked by confirmed snipes in the last eight weeks (most first). */
  ranking: string[];
  /** 0 for the highest snipe count, 1 for the next, and so on; equal counts share a place. */
  placeOf: (memberId: string) => number;
}

const RecognitionContext = createContext<RecognitionContextValue>({ data: null, reload: async () => undefined, ranking: [], placeOf: () => -1 });

/** Loads snipe counts and the latest war once for the signed-in member, for badges and boards everywhere. */
export function RecognitionProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const [data, setData] = useState<RecognitionResponse | null>(null);
  const reload = useCallback(async () => {
    try {
      const response = await fetch("/api/recognition", { cache: "no-store" });
      if (response.ok) setData(await response.json() as RecognitionResponse);
    } catch {
      // Badges are a bonus; the page works without them.
    }
  }, []);
  useEffect(() => { if (enabled) void reload(); }, [enabled, reload]);
  const ranking = Object.entries(data?.snipes.recent ?? {}).filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1] || (data?.snipes.total[b[0]] ?? 0) - (data?.snipes.total[a[0]] ?? 0)).map(([id]) => id);
  const levels = [...new Set(ranking.map((id) => data?.snipes.recent[id] ?? 0))];
  const placeOf = (memberId: string) => levels.indexOf(data?.snipes.recent[memberId] ?? -1);
  return <RecognitionContext.Provider value={{ data, reload, ranking, placeOf }}>{children}</RecognitionContext.Provider>;
}

export function useRecognition(): RecognitionContextValue {
  return useContext(RecognitionContext);
}

/** 🎯 with the member's snipe count (last 8 weeks); gold, silver and bronze for the top three. */
export function SnipeBadge({ memberId }: { memberId: string }) {
  const t = useT();
  const { data, placeOf } = useRecognition();
  const count = data?.snipes.recent[memberId] ?? 0;
  if (!count) return null;
  const place = placeOf(memberId);
  const tier = place === 0 ? "gold" : place === 1 ? "silver" : place === 2 ? "bronze" : "plain";
  const label = t("Joined {count} snipe(s) in the last 8 weeks", { count });
  return (
    <span className={`snipe-badge snipe-badge-${tier}`} title={label} aria-label={label} role="img">
      <Crosshair size={11} aria-hidden="true" />{count}
    </span>
  );
}
