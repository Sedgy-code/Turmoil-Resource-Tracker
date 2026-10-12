"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Droplets, LoaderCircle, Sparkles } from "lucide-react";
import { COSMETIC_CATEGORIES, COSMETIC_CATEGORY_LABELS, REWARD_TIERS } from "@/lib/dew";
import { numberFormat } from "@/lib/resources";
import type { CosmeticCategory, DashboardResponse, DewItem, DewResponse, Member } from "@/lib/types";
import { MemberAvatar, MemberName, MemberTitle } from "./member-identity";

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

function nextRewardReset(week: string): string {
  const nextWeek = new Date(`${week}T00:00:00.000Z`);
  nextWeek.setUTCDate(nextWeek.getUTCDate() + 7);
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Sydney", weekday: "long", day: "numeric", month: "short",
    hour: "numeric", minute: "2-digit", timeZoneName: "short",
  }).format(nextWeek);
}

function RewardPreview({ item, member }: { item: DewItem; member: Member }) {
  const preview = { ...member, badge: null, cosmetics: { badge: null, title: null, accent: null, frame: null, [item.category]: item.id } };
  if (item.category === "frame") return <div className="planning-reward-preview planning-frame-preview"><MemberAvatar member={preview} /></div>;
  if (item.category === "accent") return <div className="planning-reward-preview planning-accent-preview"><MemberName member={preview} /></div>;
  if (item.category === "title") return <div className="planning-reward-preview planning-title-preview"><Sparkles size={21} aria-hidden="true" /><MemberTitle member={preview} /></div>;
  return <div className="planning-reward-preview planning-badge-preview" aria-hidden="true">{item.symbol}</div>;
}

export function DewStore({ data, notify, refresh }: Props) {
  const [wallet, setWallet] = useState<DewResponse | null>(null);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [category, setCategory] = useState<CosmeticCategory | "all">("all");
  const loading = useRef<AbortController | null>(null);
  const mutationPending = useRef(false);
  const requestGeneration = useRef(0);

  const load = useCallback(async () => {
    if (mutationPending.current) return;
    loading.current?.abort();
    const controller = new AbortController();
    loading.current = controller;
    const generation = ++requestGeneration.current;
    try {
      const result = await request<DewResponse>("/api/dew", { signal: controller.signal });
      if (generation === requestGeneration.current) {
        setWallet(result);
        setLoadError("");
      }
    } catch (error) {
      if (!controller.signal.aborted && generation === requestGeneration.current) {
        setLoadError(error instanceof Error ? error.message : "Unable to load your Dew Points.");
      }
    }
  }, []);

  useEffect(() => {
    void load();
    const reloadWhenVisible = () => { if (document.visibilityState === "visible") void load(); };
    const interval = window.setInterval(reloadWhenVisible, 30_000);
    window.addEventListener("focus", reloadWhenVisible);
    document.addEventListener("visibilitychange", reloadWhenVisible);
    return () => {
      loading.current?.abort();
      ++requestGeneration.current;
      window.clearInterval(interval);
      window.removeEventListener("focus", reloadWhenVisible);
      document.removeEventListener("visibilitychange", reloadWhenVisible);
    };
  }, [load, data.currentUser.id]);

  function beginMutation(itemId: string) {
    mutationPending.current = true;
    loading.current?.abort();
    ++requestGeneration.current;
    setBusy(itemId);
  }

  async function purchase(item: DewItem) {
    if (mutationPending.current) return;
    beginMutation(item.id);
    try {
      setWallet(await request<DewResponse>("/api/dew/purchase", { method: "POST", body: JSON.stringify({ itemId: item.id }) }));
      setLoadError("");
      notify(`${item.name} unlocked. Equip it to update your profile.`);
    } catch (error) { notify(error instanceof Error ? error.message : "Unable to unlock this reward.", true); }
    finally { mutationPending.current = false; setBusy(null); }
  }

  async function equip(item: DewItem, remove: boolean) {
    if (mutationPending.current) return;
    beginMutation(item.id);
    try {
      setWallet(await request<DewResponse>("/api/dew/equip", {
        method: "POST", body: JSON.stringify({ itemId: remove ? null : item.id, category: item.category }),
      }));
      setLoadError("");
      await refresh();
      notify(remove ? `${COSMETIC_CATEGORY_LABELS[item.category]} removed.` : `${item.name} equipped.`);
    } catch (error) { notify(error instanceof Error ? error.message : "Unable to change your reward.", true); }
    finally { mutationPending.current = false; setBusy(null); }
  }

  if (!wallet) return (
    <section className="planning-panel planning-state" aria-live="polite">
      {loadError ? <><h2>The Reward Shop is unavailable</h2><p>{loadError}</p><button className="planning-button" onClick={() => void load()}>Try again</button></> : <><LoaderCircle size={24} className="spin" /><p>Loading your rewards…</p></>}
    </section>
  );

  const equippedMember = { ...data.currentUser, badge: wallet.equippedCosmetics.badge, cosmetics: wallet.equippedCosmetics };
  const filtered = (items: DewItem[]) => items.filter((item) => category === "all" || item.category === category);
  const legacyItems = filtered(wallet.items.filter((item) => item.legacy));

  function rewardCard(item: DewItem) {
    if (!wallet) return null;
    const owned = wallet.owned.includes(item.id);
    const equipped = wallet.equippedCosmetics[item.category] === item.id;
    const affordable = wallet.balance >= item.cost;
    return (
      <article className={`planning-store-card dew-item${equipped ? " equipped" : ""}`} key={item.id} aria-label={item.name}>
        <span className="planning-reward-category">{COSMETIC_CATEGORY_LABELS[item.category]}</span>
        <RewardPreview item={item} member={data.currentUser} />
        <h3>{item.name}</h3>
        <p className="planning-store-price"><Droplets size={13} aria-hidden="true" />{numberFormat(item.cost)} Dew Points</p>
        <div className="planning-reward-ownership">
          {owned ? <span><Check size={12} aria-hidden="true" />{equipped ? "Equipped" : "Owned"}</span> : <span>{affordable ? "Ready to unlock" : `${numberFormat(item.cost - wallet.balance)} more points needed`}</span>}
        </div>
        {owned ? <div className="planning-reward-progress planning-reward-progress-owned" aria-hidden="true" /> : <div className="planning-reward-progress" role="progressbar" aria-label={`Progress toward ${item.name}`} aria-valuemin={0} aria-valuemax={item.cost} aria-valuenow={Math.min(wallet.balance, item.cost)}><span style={{ width: `${Math.min(100, wallet.balance / item.cost * 100)}%` }} /></div>}
        {owned ? (
          <button className={`planning-button${equipped ? " planning-button-subtle" : ""}`} onClick={() => void equip(item, equipped)} disabled={busy !== null}>
            {busy === item.id && <LoaderCircle size={15} className="spin" />}{equipped ? `Remove ${COSMETIC_CATEGORY_LABELS[item.category].toLowerCase()}` : `Equip ${COSMETIC_CATEGORY_LABELS[item.category].toLowerCase()}`}
          </button>
        ) : (
          <button className="planning-button" onClick={() => void purchase(item)} disabled={busy !== null || !affordable}>
            {busy === item.id && <LoaderCircle size={15} className="spin" />}{affordable ? `Unlock for ${numberFormat(item.cost)} points` : `Need ${numberFormat(item.cost - wallet.balance)} more points`}
          </button>
        )}
      </article>
    );
  }

  return (
    <div className="planning-stack planning-reward-shop">
      <section className="planning-panel planning-dew-intro">
        <div className="planning-heading">
          <div><span className="planning-eyebrow">Stay ready. Make it yours.</span><h2>Reward Shop</h2><p>Earn up to 30 Dew Points each clan week. Choose a badge, title, name accent and avatar frame to build your profile.</p></div>
          <div className="planning-dew-balance" aria-label={`${wallet.balance} Dew Points available`}><Droplets size={20} aria-hidden="true" /><strong>{numberFormat(wallet.balance)}</strong><span>Dew Points</span></div>
        </div>
        <div className="planning-weekly-rewards" aria-label="This week’s Dew Point rewards">
          <div className={`planning-weekly-reward${wallet.resourceRewardEarned ? " earned" : ""}`}>
            {wallet.resourceRewardEarned ? <Check size={19} /> : <Sparkles size={19} />}
            <div><strong>Complete resource update <span>+20 points</span></strong><p>{wallet.resourceRewardEarned ? "Earned this week. Keep your information current for the clan." : "Submit every resource quantity, summon cost, level and extra summon chance this week."}</p></div>
            <span className="planning-reward-status">{wallet.resourceRewardEarned ? "Earned" : "Pending"}</span>
          </div>
          <div className={`planning-weekly-reward${wallet.snipeRewardEarned ? " earned" : ""}`}>
            {wallet.snipeRewardEarned ? <Check size={19} /> : <Sparkles size={19} />}
            <div><strong>Snipe participation <span>+10 points</span></strong><p>{wallet.snipeRewardEarned ? "Earned this week. Your attendance has been confirmed." : "Attend a snipe this week and have an admin confirm your participation."}</p></div>
            <span className="planning-reward-status">{wallet.snipeRewardEarned ? "Earned" : "Pending"}</span>
          </div>
        </div>
        <p className="planning-footnote">Each reward is earned once per clan week. Next reset: {nextRewardReset(wallet.rewardWeek)} (Sydney time). Incomplete resource information must be completed before it can be saved or earn points.</p>
      </section>

      <section className="planning-panel planning-equipped-profile" aria-label="Your equipped rewards">
        <div className="planning-profile-preview"><MemberAvatar member={equippedMember} /><div><span className="planning-eyebrow">Your profile</span><MemberName member={equippedMember} /><MemberTitle member={equippedMember} /></div></div>
        <dl className="planning-equipped-slots">{COSMETIC_CATEGORIES.map((slot) => <div key={slot}><dt>{COSMETIC_CATEGORY_LABELS[slot]}</dt><dd>{wallet.items.find((item) => item.id === wallet.equippedCosmetics[slot])?.name ?? "None equipped"}</dd></div>)}</dl>
        <p>You can equip one reward from each category together.</p>
      </section>

      {loadError && <div className="planning-notice planning-shop-load-error" role="alert">{loadError}<button className="planning-button planning-button-subtle" onClick={() => void load()}>Refresh rewards</button></div>}

      <div className="planning-tabs planning-shop-filters" aria-label="Reward categories">
        <button aria-pressed={category === "all"} onClick={() => setCategory("all")}>All rewards</button>
        {COSMETIC_CATEGORIES.map((slot) => <button key={slot} aria-pressed={category === slot} onClick={() => setCategory(slot)}>{COSMETIC_CATEGORY_LABELS[slot]}</button>)}
      </div>

      {REWARD_TIERS.map((price, index) => {
        const items = filtered(wallet.items.filter((item) => !item.legacy && item.cost === price));
        return items.length ? (
          <section className="planning-reward-tier" key={price} aria-label={`Tier ${index + 1}: ${price} Dew Points each`}>
            <div className="planning-tier-heading"><div><span className="planning-eyebrow">Tier {index + 1}</span><h2>{numberFormat(price)} Dew Points <small>per item</small></h2></div><span>{category === "all" ? "Four ways to make your profile yours" : COSMETIC_CATEGORY_LABELS[category]}</span></div>
            <div className="planning-store-grid">{items.map(rewardCard)}</div>
          </section>
        ) : null;
      })}

      {legacyItems.length > 0 && <section className="planning-reward-tier planning-legacy-rewards" aria-label="Original rewards"><div className="planning-tier-heading"><div><span className="planning-eyebrow">The original collection</span><h2>Classic badges</h2></div><span>Your earlier purchases are still yours</span></div><div className="planning-store-grid">{legacyItems.map(rewardCard)}</div></section>}
    </div>
  );
}
