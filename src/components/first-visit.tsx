"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { errorText } from "@/lib/error-text";
import { createPortal } from "react-dom";
import Link from "next/link";
import { ArrowRight, Bell, Check, Download, Swords, Target, X } from "lucide-react";
import { useT } from "@/lib/i18n";
import type { Member } from "@/lib/types";
import { CoinStack } from "./home-icons";
import "./first-visit.css";

/* What a new member needs, at the moment they need it: a welcome card with the three weekly jobs,
   a "?" on each clan word, and, after their first save, help adding the Hub to the home screen and
   a choice about Discord reminders. No tour to sit through. */

function readFlag(key: string): boolean {
  try { return window.localStorage.getItem(key) === "1"; } catch { return false; }
}
function writeFlag(key: string) {
  try { window.localStorage.setItem(key, "1"); } catch { /* private mode: this visit only */ }
}

/** Clan words a newcomer meets on the first screens, each explained in one or two sentences. */
export const TERMS = {
  clanDay: { word: "Clan day", text: "A war day leadership picked for spending. Everyone spends on the same days, so the clan’s points add up." },
  hold: { word: "Hold", text: "Today isn’t a clan day. Keep your resources and spend them on the next clan day." },
  blackMark: { word: "Black mark", text: "Given in a war when more than 10% of your war points came on days that weren’t clan days." },
  snipe: { word: "Snipe", text: "A set time when members spend together, all at once, to get ahead of another clan. Say Yes if you can be online then." },
  ascending: { word: "Ascending", text: "Ascending your Forge, Skills, Mounts or Pets in the game this week. Everyone can see it, so leaders can plan the war around it." },
  techRace: { word: "Clan Tech Race", text: "A week-long race where clans donate Clan Tech Vials. Each day at 00:00 UTC the lowest clans are knocked out." },
  warPoints: { word: "Potential war points", text: "An estimate of the war points the clan could score if everyone spent what they’ve saved on the right days." },
} as const;
export type Term = keyof typeof TERMS;

/** A small "?" after a clan word; tapping it shows what the word means, in the member's language. */
export function TermHelp({ term }: { term: Term }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const word = t(TERMS[term].word);
  useEffect(() => {
    if (!open) return;
    sheet.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const away = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!sheet.current?.contains(target) && !button.current?.contains(target)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); button.current?.focus(); } };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", key); };
  }, [open]);
  return <>
    <button
      ref={button}
      type="button"
      className="term-help"
      aria-expanded={open}
      aria-controls={open ? id : undefined}
      aria-label={t("What does “{word}” mean?", { word })}
      onClick={(event) => { event.preventDefault(); event.stopPropagation(); setOpen(!open); }}
    >?</button>
    {/* On the page itself, outside any card, so it can sit at the bottom of the screen. */}
    {open && createPortal(<div ref={sheet} className="term-sheet" id={id} role="dialog" aria-label={word}>
      <p><strong>{word}</strong>{" "}{t(TERMS[term].text)}</p>
      <button type="button" className="term-sheet-close" aria-label={t("Close")} onClick={() => { setOpen(false); button.current?.focus(); }}><X size={18} /></button>
    </div>, document.body)}
  </>;
}

const WELCOME_KEY = "turmoil-welcome-done";

/** First visit (nothing saved yet): what the Hub is for, as the three jobs each week. Dismissed for good on this phone. */
export function WelcomeCard() {
  const t = useT();
  const [hidden, setHidden] = useState(true);
  useEffect(() => setHidden(readFlag(WELCOME_KEY)), []);
  if (hidden) return null;
  const close = () => { writeFlag(WELCOME_KEY); setHidden(true); };
  return <section className="home-card welcome-card" aria-labelledby="welcome-title">
    <div className="home-card-head">
      <h2 id="welcome-title">{t("Welcome to the Clan Hub")}</h2>
      <button type="button" className="welcome-close" aria-label={t("Close")} onClick={close}><X size={18} /></button>
    </div>
    <p className="welcome-lead">{t("Three jobs each week, and the Hub tells you when each one is done.")}</p>
    <ul className="welcome-jobs">
      <li><span className="welcome-mark gold" aria-hidden="true"><CoinStack size={22} /></span><div><strong>{t("Save your resources")}</strong><small>{t("Copy your numbers from the game. It takes about 2 minutes and earns 20 Clan Points.")}</small></div></li>
      <li><span className="welcome-mark" aria-hidden="true"><Swords size={20} /></span><div><strong>{t("Check Today before you spend")}</strong><small>{t("Spend only on clan days. Spending on other days can earn a black mark.")}</small></div></li>
      <li><span className="welcome-mark" aria-hidden="true"><Target size={20} /></span><div><strong>{t("Answer snipes and votes")}</strong><small>{t("Say if you can join a snipe, and vote for next war’s days. Each earns 10 Clan Points.")}</small></div></li>
    </ul>
    <div className="welcome-actions">
      <Link className="home-hero-cta" href="/resources" onClick={close}><CoinStack size={22} /><span>{t("Add my resources")}</span><ArrowRight size={18} aria-hidden="true" /></Link>
      <button type="button" className="button subtle" onClick={close}>{t("Got it")}</button>
    </div>
  </section>;
}

/* "Add to home screen": Android's browsers can offer an install button; iPhones never do. */
interface InstallEvent extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> }
let installEvent: InstallEvent | null = null;
const installListeners = new Set<() => void>();
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installEvent = event as InstallEvent;
    installListeners.forEach((listener) => listener());
  });
  window.addEventListener("appinstalled", () => {
    installEvent = null;
    installListeners.forEach((listener) => listener());
  });
}
const subscribe = (listener: () => void) => { installListeners.add(listener); return () => { installListeners.delete(listener); }; };

/** Opened from the home screen (no browser bar)? */
export function isStandalone(): boolean {
  try {
    return window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  } catch { return false; }
}
function phoneKind(): "iphone" | "android" | "other" {
  const agent = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(agent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) return "iphone";
  return /Android/.test(agent) ? "android" : "other";
}

/** The steps to add the Hub to this phone's home screen, or one Install button where the browser offers it. */
export function InstallSteps() {
  const t = useT();
  const canInstall = useSyncExternalStore(subscribe, () => installEvent !== null, () => false);
  const [kind, setKind] = useState<"iphone" | "android" | "other">("other");
  const [installed, setInstalled] = useState(false);
  useEffect(() => { setKind(phoneKind()); setInstalled(isStandalone()); }, []);
  if (installed) return <p className="install-done"><Check size={16} aria-hidden="true" />{t("You’re using the Hub from your home screen.")}</p>;
  return <div className="install-steps">
    {canInstall && <button type="button" className="button primary install-button" onClick={async () => {
      const event = installEvent;
      if (!event) return;
      await event.prompt();
      const choice = await event.userChoice.catch(() => null);
      if (choice?.outcome === "accepted") { installEvent = null; setInstalled(true); }
    }}><Download size={17} />{t("Add the Hub to my home screen")}</button>}
    {!canInstall && <ol>
      {kind === "iphone" ? <>
        <li>{t("Open the Hub in Safari. From Discord, tap ⋯ and choose “Open in browser”.")}</li>
        <li>{t("Tap the Share button, then “Add to Home Screen”.")}</li>
        <li>{t("Open the Hub from your home screen and sign in with Discord once more.")}</li>
      </> : kind === "android" ? <>
        <li>{t("Open the Hub in Chrome. From Discord, tap ⋮ and choose “Open in browser”.")}</li>
        <li>{t("Tap ⋮, then “Add to Home screen” or “Install app”.")}</li>
        <li>{t("Open the Hub from your home screen and sign in with Discord once more.")}</li>
      </> : <>
        <li>{t("On your phone, open the Hub in Safari (iPhone) or Chrome (Android).")}</li>
        <li>{t("Use the browser’s menu to add it to your home screen.")}</li>
      </>}
    </ol>}
  </div>;
}

/** Turns Discord reminders on or off for this member (the Me page and the after-save sheet). */
export async function saveReminders(allowed: boolean): Promise<Member> {
  const response = await fetch("/api/me", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ remindersAllowed: allowed }) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "Please try again.");
  return result.member as Member;
}

const AFTER_SAVE_KEY = "turmoil-after-save-done";
/** Worth showing after a save: once per phone, and only if there's something left to offer. */
export function shouldOfferAfterSave(member: Member): boolean {
  if (readFlag(AFTER_SAVE_KEY)) return false;
  return !isStandalone() || !member.remindersAllowed;
}

/** Right after a member saves: add the Hub to the home screen, and choose Discord reminders. Shown once per phone. */
export function AfterSaveSheet({ member, onClose, notify }: { member: Member; onClose: () => void; notify: (message: string, error?: boolean) => void }) {
  const t = useT();
  const [reminders, setReminders] = useState(member.remindersAllowed === true);
  const [busy, setBusy] = useState(false);
  const [standalone, setStandalone] = useState(true);
  const done = useRef<HTMLButtonElement>(null);
  useEffect(() => { setStandalone(isStandalone()); done.current?.focus(); }, []);
  const close = () => { writeFlag(AFTER_SAVE_KEY); onClose(); };
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  });
  return <div className="modal-backdrop after-save-backdrop" onClick={close}>
    <section className="after-save" role="dialog" aria-modal="true" aria-labelledby="after-save-title" onClick={(event) => event.stopPropagation()}>
      <h2 id="after-save-title"><span className="after-save-tick" aria-hidden="true"><Check size={18} strokeWidth={3} /></span>{t("Saved! Two quick extras")}</h2>
      {!standalone && <div className="after-save-part">
        <h3><Download size={17} aria-hidden="true" />{t("Add the Hub to your home screen")}</h3>
        <p>{t("It opens like an app, without the browser bar.")}</p>
        <InstallSteps />
      </div>}
      {!member.remindersAllowed && <div className="after-save-part">
        <h3><Bell size={17} aria-hidden="true" />{t("Want a reminder if you forget?")}</h3>
        <p>{t("If you haven’t saved, a leader can send you one Discord message a week. Never more.")}</p>
        <button type="button" className={`button ${reminders ? "secondary" : "primary"}`} disabled={busy || reminders} onClick={async () => {
          setBusy(true);
          try { await saveReminders(true); setReminders(true); notify(t("Discord reminders are on.")); }
          catch (error) { notify(t(errorText(error)), true); }
          finally { setBusy(false); }
        }}>{reminders ? <><Check size={16} />{t("Reminders are on")}</> : <><Bell size={16} />{t("Yes, remind me")}</>}</button>
      </div>}
      <button ref={done} type="button" className="button subtle after-save-done" onClick={close}>{t("Done")}</button>
    </section>
  </div>;
}
