"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Coins, LoaderCircle, Sparkles } from "lucide-react";
import { COSMETIC_CATEGORIES, COSMETIC_CATEGORY_LABELS, REWARD_TIERS } from "@/lib/dew";
import { announceClanPointsUpdate } from "@/lib/clan-points";
import { numberFormat } from "@/lib/resources";
import type { CosmeticCategory, DashboardResponse, DewItem, DewResponse, Member } from "@/lib/types";
import { MemberAvatar, MemberName, MemberTitle } from "./member-identity";
import { useT } from "@/lib/i18n";

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
  const t = useT();
  const categoryLabel = (slot: CosmeticCategory) => t(COSMETIC_CATEGORY_LABELS[slot]);
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
        announceClanPointsUpdate(data.currentUser.id, result.balance);
        setLoadError("");
      }
    } catch (error) {
      if (!controller.signal.aborted && generation === requestGeneration.current) {
        setLoadError(error instanceof Error ? error.message : "Unable to load your Clan Points.");
      }
    }
  }, [data.currentUser.id]);

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
      const updated = await request<DewResponse>("/api/dew/purchase", { method: "POST", body: JSON.stringify({ itemId: item.id }) });
      setWallet(updated);
      announceClanPointsUpdate(data.currentUser.id, updated.balance);
      setLoadError("");
      notify(t("{name} unlocked. Equip it to show it on your profile.", { name: item.name }));
    } catch (error) { notify(error instanceof Error ? error.message : "Unable to unlock this reward.", true); }
    finally { mutationPending.current = false; setBusy(null); }
  }

  async function equip(item: DewItem, remove: boolean) {
    if (mutationPending.current) return;
    beginMutation(item.id);
    try {
      const updated = await request<DewResponse>("/api/dew/equip", {
        method: "POST", body: JSON.stringify({ itemId: remove ? null : item.id, category: item.category }),
      });
      setWallet(updated);
      announceClanPointsUpdate(data.currentUser.id, updated.balance);
      setLoadError("");
      await refresh();
      notify(remove ? t("{name} removed.", { name: categoryLabel(item.category) }) : t("{name} equipped.", { name: item.name }));
    } catch (error) { notify(error instanceof Error ? error.message : "Unable to change your reward.", true); }
    finally { mutationPending.current = false; setBusy(null); }
  }

  if (!wallet) return (
    <section className="planning-panel planning-state" aria-live="polite">
      {loadError ? <><h2>{t("The Reward Shop is unavailable")}</h2><p>{t(loadError)}</p><button className="planning-button" onClick={() => void load()}>{t("Try again")}</button></> : <><LoaderCircle size={24} className="spin" /><p>{t("Loading…")}</p></>}
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
        <span className="planning-reward-category">{categoryLabel(item.category)}</span>
        <RewardPreview item={item} member={data.currentUser} />
        <h3>{item.name}</h3>
        <p className="planning-store-price"><Coins size={13} aria-hidden="true" />{t("{count} Clan Points", { count: numberFormat(item.cost) })}</p>
        <div className="planning-reward-ownership">
          {owned ? <span><Check size={12} aria-hidden="true" />{t(equipped ? "Equipped" : "Owned")}</span> : <span>{affordable ? t("Ready to unlock") : t("{count} more points needed", { count: numberFormat(item.cost - wallet.balance) })}</span>}
        </div>
        {owned ? <div className="planning-reward-progress planning-reward-progress-owned" aria-hidden="true" /> : <div className="planning-reward-progress" role="progressbar" aria-label={`Progress toward ${item.name}`} aria-valuemin={0} aria-valuemax={item.cost} aria-valuenow={Math.min(wallet.balance, item.cost)}><span style={{ width: `${Math.min(100, wallet.balance / item.cost * 100)}%` }} /></div>}
        {owned ? (
          <button className={`planning-button${equipped ? " planning-button-subtle" : ""}`} onClick={() => void equip(item, equipped)} disabled={busy !== null}>
            {busy === item.id && <LoaderCircle size={15} className="spin" />}{equipped ? t("Remove") : t("Equip")}
          </button>
        ) : (
          <button className="planning-button" onClick={() => void purchase(item)} disabled={busy !== null || !affordable}>
            {busy === item.id && <LoaderCircle size={15} className="spin" />}{affordable ? t("Unlock for {count} points", { count: numberFormat(item.cost) }) : t("{count} more points needed", { count: numberFormat(item.cost - wallet.balance) })}
          </button>
        )}
      </article>
    );
  }

  return (
    <div className="planning-stack planning-reward-shop">
      <section className="planning-panel planning-dew-intro">
        <div className="planning-heading">
          <div><h2>{t("Reward Shop")}</h2><p>{t("Earn up to 40 Clan Points each week. Spend them on a badge, title, name colour and avatar frame.")}</p></div>
          <div className="planning-dew-balance" aria-label={`${wallet.balance} Clan Points available`}><Coins size={20} aria-hidden="true" /><strong>{numberFormat(wallet.balance)}</strong><span>{t("Clan Points")}</span></div>
        </div>
        <div className="planning-weekly-rewards" aria-label="This week’s Clan Point rewards">
          <div className={`planning-weekly-reward${wallet.resourceRewardEarned ? " earned" : ""}`}>
            {wallet.resourceRewardEarned ? <Check size={19} /> : <Sparkles size={19} />}
            <div><strong>{t("Save your resources")} <span>{t("+20 points")}</span></strong><p>{t(wallet.resourceRewardEarned ? "Done for this week. Thank you!" : "Fill in every box in My Resources and press Save this week.")}</p></div>
            <span className="planning-reward-status">{t(wallet.resourceRewardEarned ? "Earned" : "Pending")}</span>
          </div>
          <div className={`planning-weekly-reward${wallet.snipeRewardEarned ? " earned" : ""}`}>
            {wallet.snipeRewardEarned ? <Check size={19} /> : <Sparkles size={19} />}
            <div><strong>{t("Join a snipe")} <span>{t("+10 points")}</span></strong><p>{t(wallet.snipeRewardEarned ? "Done for this week. An admin confirmed you joined." : "Join a snipe this week. An admin confirms who took part.")}</p></div>
            <span className="planning-reward-status">{t(wallet.snipeRewardEarned ? "Earned" : "Pending")}</span>
          </div>
          <div className={`planning-weekly-reward${wallet.voteRewardEarned ? " earned" : ""}`}>
            {wallet.voteRewardEarned ? <Check size={19} /> : <Sparkles size={19} />}
            <div><strong>{t("Vote for clan days")} <span>{t("+10 points")}</span></strong><p>{t(wallet.voteRewardEarned ? "Done. Thanks for voting!" : "On Days 6 and 7, vote on Home for the days to fight next war.")}</p></div>
            <span className="planning-reward-status">{t(wallet.voteRewardEarned ? "Earned" : "Pending")}</span>
          </div>
        </div>
        <p className="planning-footnote">{t("Each reward can be earned once a week. Next reset: {date} (Sydney time).", { date: nextRewardReset(wallet.rewardWeek) })}</p>
      </section>

      <section className="planning-panel planning-equipped-profile" aria-label="Your equipped rewards">
        <div className="planning-profile-preview"><MemberAvatar member={equippedMember} /><div><span className="planning-eyebrow">{t("Your profile")}</span><MemberName member={equippedMember} /><MemberTitle member={equippedMember} /></div></div>
        <dl className="planning-equipped-slots">{COSMETIC_CATEGORIES.map((slot) => <div key={slot}><dt>{categoryLabel(slot)}</dt><dd>{wallet.items.find((item) => item.id === wallet.equippedCosmetics[slot])?.name ?? t("None equipped")}</dd></div>)}</dl>
        <p>{t("You can wear one reward from each type at the same time.")}</p>
      </section>

      {loadError && <div className="planning-notice planning-shop-load-error" role="alert">{t(loadError)}<button className="planning-button planning-button-subtle" onClick={() => void load()}>{t("Refresh")}</button></div>}

      <div className="planning-tabs planning-shop-filters" aria-label="Reward categories">
        <button aria-pressed={category === "all"} onClick={() => setCategory("all")}>{t("All rewards")}</button>
        {COSMETIC_CATEGORIES.map((slot) => <button key={slot} aria-pressed={category === slot} onClick={() => setCategory(slot)}>{categoryLabel(slot)}</button>)}
      </div>

      {REWARD_TIERS.map((price, index) => {
        const items = filtered(wallet.items.filter((item) => !item.legacy && item.cost === price));
        return items.length ? (
          <section className="planning-reward-tier" key={price} aria-label={`Tier ${index + 1}: ${price} Clan Points each`}>
            <div className="planning-tier-heading"><div><span className="planning-eyebrow">{t("Tier {number}", { number: index + 1 })}</span><h2>{t("{count} Clan Points", { count: numberFormat(price) })} <small>{t("per item")}</small></h2></div><span>{category === "all" ? t("Four ways to make your profile yours") : categoryLabel(category)}</span></div>
            <div className="planning-store-grid">{items.map(rewardCard)}</div>
          </section>
        ) : null;
      })}

      {/* The original collection folds away: it's older, cheaper badges most members already know. */}
      {legacyItems.length > 0 && <details className="planning-reward-tier planning-legacy-rewards" aria-label="Original rewards"><summary className="planning-tier-heading"><div><span className="planning-eyebrow">{t("The original collection")}</span><h2>{t("Classic badges")}</h2></div><span>{t("Your earlier purchases are still yours")}</span><ChevronDown size={18} className="planning-legacy-chevron" aria-hidden="true" /></summary><div className="planning-store-grid">{legacyItems.map(rewardCard)}</div></details>}
    </div>
  );
}
