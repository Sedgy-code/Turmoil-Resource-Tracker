"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Droplets, LoaderCircle, Sparkles } from "lucide-react";
import { numberFormat } from "@/lib/resources";
import type { DashboardResponse, DewResponse } from "@/lib/types";

type Props = {
  data: DashboardResponse;
  notify: (message: string, error?: boolean) => void;
  refresh: () => Promise<void>;
};

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
    cache: "no-store",
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Please try again.");
  return result as T;
}

export function DewStore({ data, notify, refresh }: Props) {
  const [wallet, setWallet] = useState<DewResponse | null>(null);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoadError("");
    try { setWallet(await request<DewResponse>("/api/dew")); }
    catch (error) { setLoadError(error instanceof Error ? error.message : "Unable to load your Dew."); }
  }, []);
  useEffect(() => { void load(); }, [load, data.currentUser.id]);

  async function purchase(itemId: string) {
    setBusy(itemId);
    try {
      const updated = await request<DewResponse>("/api/dew/purchase", { method: "POST", body: JSON.stringify({ itemId }) });
      setWallet(updated);
      notify("Badge unlocked. Equip it to show it beside your name.");
    } catch (error) { notify(error instanceof Error ? error.message : "Unable to unlock this badge.", true); }
    finally { setBusy(null); }
  }
  async function equip(itemId: string | null, pendingId: string) {
    setBusy(pendingId);
    try {
      setWallet(await request<DewResponse>("/api/dew/equip", { method: "POST", body: JSON.stringify({ itemId }) }));
      await refresh();
      notify(itemId ? "Your badge is equipped." : "Your badge was removed.");
    } catch (error) { notify(error instanceof Error ? error.message : "Unable to change your badge.", true); }
    finally { setBusy(null); }
  }

  if (!wallet) return <section className="planning-panel planning-state" aria-live="polite">{loadError ? <><h2>The Dew store is unavailable</h2><p>{loadError}</p><button className="planning-button" onClick={() => void load()}>Try again</button></> : <><LoaderCircle size={24} className="spin" /><p>Loading your Dew…</p></>}</section>;
  return <div className="planning-stack">
    <section className="planning-panel planning-dew-intro"><div className="planning-heading"><div><span className="planning-eyebrow">A little reward for staying ready</span><h2>Dew store</h2><p>Earn 1 Dew each day you update your own resource quantities. Unlock a badge and wear it beside your name.</p></div><div className="planning-dew-balance" aria-label={`${wallet.balance} Dew available`}><Droplets size={20} /><strong>{numberFormat(wallet.balance)}</strong><span>Dew</span></div></div><div className={`planning-dew-status ${wallet.earnedToday ? "earned" : ""}`}>{wallet.earnedToday ? <Check size={16} /> : <Sparkles size={16} />}<span>{wallet.earnedToday ? "Today’s Dew earned. Thanks for keeping your bank up to date." : "Update your resource quantities in My Resources to earn today’s Dew."}</span></div><p className="planning-footnote">One reward per day, resetting at midnight UTC. Badges are cosmetic and keep your Discord avatar and display name.</p></section>
    <div className="planning-store-grid">{wallet.items.map((item) => {
      const owned = wallet.owned.includes(item.id);
      const equipped = wallet.equipped === item.id;
      const affordable = wallet.balance >= item.cost;
      return <article className={`planning-store-card dew-item ${equipped ? "equipped" : ""}`} key={item.id} aria-label={item.name}>
        <div className="planning-store-symbol" aria-hidden="true">{item.symbol}</div><h3>{item.name}</h3><p className="planning-store-price"><Droplets size={13} />{numberFormat(item.cost)} Dew{owned && <span><Check size={12} />Owned</span>}</p>
        {owned ? <button className={`planning-button ${equipped ? "planning-button-subtle" : ""}`} onClick={() => void equip(equipped ? null : item.id, item.id)} disabled={busy !== null}>{busy === item.id && <LoaderCircle size={15} className="spin" />}{equipped ? "Remove badge" : "Equip badge"}</button> : <button className="planning-button" onClick={() => void purchase(item.id)} disabled={busy !== null || !affordable}>{busy === item.id && <LoaderCircle size={15} className="spin" />}{affordable ? `Unlock for ${numberFormat(item.cost)} Dew` : `Need ${numberFormat(item.cost - wallet.balance)} more Dew`}</button>}
        {equipped && <span className="planning-equipped-label"><Check size={12} />Equipped</span>}
      </article>;
    })}</div>
  </div>;
}
