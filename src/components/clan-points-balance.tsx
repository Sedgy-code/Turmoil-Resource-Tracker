"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { CLAN_POINTS_UPDATED, type ClanPointsUpdate } from "@/lib/clan-points";
import { numberFormat } from "@/lib/resources";
import { useT } from "@/lib/i18n";
import { CrownShield } from "./crown-shield";

export function ClanPointsBalance({ memberId, revision }: { memberId: string; revision?: string | null }) {
  const t = useT();
  const [wallet, setWallet] = useState<{ memberId: string; balance: number } | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const load = useCallback(async () => {
    controller.current?.abort();
    const pending = new AbortController();
    controller.current = pending;
    const requestGeneration = ++generation.current;
    try {
      const response = await fetch("/api/dew", { cache: "no-store", signal: pending.signal });
      if (!response.ok) {
        if ((response.status === 401 || response.status === 403) && requestGeneration === generation.current) setWallet(null);
        throw new Error("Balance unavailable");
      }
      const result = await response.json() as { balance: number };
      if (!Number.isSafeInteger(result.balance) || result.balance < 0) throw new Error("Balance unavailable");
      if (requestGeneration === generation.current) {
        setWallet({ memberId, balance: result.balance });
        setUnavailable(false);
      }
    } catch {
      if (!pending.signal.aborted && requestGeneration === generation.current) setUnavailable(true);
    }
  }, [memberId]);

  useEffect(() => {
    const whenVisible = () => { if (document.visibilityState === "visible") void load(); };
    const updated = (event: Event) => {
      const detail = (event as CustomEvent<ClanPointsUpdate>).detail;
      if (!detail || detail.memberId !== memberId) return;
      if (typeof detail.balance === "number" && Number.isSafeInteger(detail.balance) && detail.balance >= 0) {
        controller.current?.abort();
        ++generation.current;
        setWallet({ memberId, balance: detail.balance });
        setUnavailable(false);
      } else void load();
    };
    const interval = window.setInterval(whenVisible, 30_000);
    window.addEventListener("focus", whenVisible);
    document.addEventListener("visibilitychange", whenVisible);
    window.addEventListener(CLAN_POINTS_UPDATED, updated);
    return () => {
      controller.current?.abort();
      ++generation.current;
      window.clearInterval(interval);
      window.removeEventListener("focus", whenVisible);
      document.removeEventListener("visibilitychange", whenVisible);
      window.removeEventListener(CLAN_POINTS_UPDATED, updated);
    };
  }, [memberId, load]);
  useEffect(() => { void load(); }, [load, revision]);

  const balance = wallet?.memberId === memberId ? wallet.balance : null;
  return <Link className="topbar-clan-points" href="/reward-shop"
    aria-label={balance === null ? t("Clan Points. Open the Reward Shop.") : t("{count} Clan Points. Open the Reward Shop.", { count: numberFormat(balance) })}
    title={unavailable ? t("Couldn’t update your Clan Points. Open the Reward Shop to try again.") : t("Your Clan Points. Open the Reward Shop.")}>
    <CrownShield size={19} />
    <span className="topbar-points-label">{t("Clan Points")}</span>
    <strong aria-live="polite" aria-atomic="true">{balance === null ? "—" : numberFormat(balance)}</strong>
  </Link>;
}
