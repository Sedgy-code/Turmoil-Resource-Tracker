"use client";

import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";
import { useT } from "@/lib/i18n";

const OWNER_KEY = "turmoil-offline-owner";

/**
 * Offline support (public/sw.js): only on the real Hub, so testing never keeps old code. When a
 * different member signs in on this phone, what the last one kept is forgotten.
 */
export function useOfflineSupport(memberId?: string | null) {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!memberId) return;
    try {
      const owner = localStorage.getItem(OWNER_KEY);
      if (owner && owner !== memberId) void forgetOfflineCopies();
      localStorage.setItem(OWNER_KEY, memberId);
    } catch { /* storage blocked: nothing to compare */ }
  }, [memberId]);
}

/** Signing out forgets what this phone kept for offline use. */
export async function forgetOfflineCopies() {
  try {
    navigator.serviceWorker?.controller?.postMessage("turmoil-sign-out");
    if ("caches" in window) await Promise.all(["turmoil-pages", "turmoil-data"].map((name) => caches.delete(name)));
  } catch { /* nothing kept */ }
}

/** True while the phone has no connection. */
export function useOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    setOnline(navigator.onLine);
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => { window.removeEventListener("online", up); window.removeEventListener("offline", down); };
  }, []);
  return online;
}

/** A line at the top of the page while offline: what you see is what this phone kept. */
export function OfflineBanner() {
  const t = useT();
  const online = useOnline();
  if (online) return null;
  return <p className="offline-banner" role="status"><WifiOff size={17} aria-hidden="true" />{t("You’re offline. You’re seeing what this phone saved last time.")}</p>;
}
