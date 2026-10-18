"use client";

import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useT } from "@/lib/i18n";

/** How far (after the rubber-band slowdown) the page has to be pulled before letting go refreshes it. */
const READY = 70;
const FURTHEST = 110;

/** Opened from the phone's home screen (phone browsers already pull to refresh by themselves). */
function homeScreenApp(): boolean {
  try {
    return window.matchMedia("(display-mode: standalone)").matches
      || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  } catch {
    return false;
  }
}

/**
 * Pull down at the top of the page to refresh, like other phone apps: a gold loading icon follows the
 * finger and spins while the page loads again. Only in the app opened from the home screen.
 */
export function PullToRefresh({ onRefresh }: { onRefresh: () => Promise<unknown> }) {
  const t = useT();
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const gesture = useRef({ startY: 0, tracking: false, pull: 0, busy: false });
  const refresh = useRef(onRefresh);
  useEffect(() => { refresh.current = onRefresh; }, [onRefresh]);

  useEffect(() => {
    if (!homeScreenApp()) return;
    // No rubber-band bounce at the top: the loading icon shows the pull instead.
    document.documentElement.classList.add("home-screen-app");
    const state = gesture.current;
    const reset = () => { state.pull = 0; setPull(0); };
    const start = (event: TouchEvent) => {
      if (state.busy || event.touches.length !== 1 || window.scrollY > 0) return;
      // Not inside the menu, a dialog, or anything that scrolls by itself.
      if ((event.target as Element | null)?.closest?.(".modal-backdrop, .sidebar.open, .notification-panel, [data-no-pull]")) return;
      state.startY = event.touches[0].clientY;
      state.tracking = true;
      state.pull = 0;
    };
    const move = (event: TouchEvent) => {
      if (!state.tracking) return;
      const distance = event.touches[0].clientY - state.startY;
      if (distance <= 0 || window.scrollY > 0) {
        if (state.pull) reset();
        return;
      }
      state.pull = Math.min(FURTHEST, distance * 0.5);
      setPull(state.pull);
      if (event.cancelable) event.preventDefault();
    };
    const end = async () => {
      if (!state.tracking) return;
      state.tracking = false;
      if (state.pull < READY) return reset();
      state.busy = true;
      setRefreshing(true);
      setPull(READY);
      try {
        // A short minimum, so the spin is seen even when the hub answers at once.
        await Promise.all([refresh.current(), new Promise((resolve) => setTimeout(resolve, 650))]);
      } finally {
        state.busy = false;
        setRefreshing(false);
        reset();
      }
    };
    window.addEventListener("touchstart", start, { passive: true });
    window.addEventListener("touchmove", move, { passive: false });
    window.addEventListener("touchend", end);
    window.addEventListener("touchcancel", end);
    return () => {
      window.removeEventListener("touchstart", start);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", end);
      window.removeEventListener("touchcancel", end);
    };
  }, []);

  if (!pull && !refreshing) return null;
  return (
    <div
      className={`pull-refresh${refreshing ? " refreshing" : ""}${pull >= READY ? " ready" : ""}`}
      // Slides down from the top edge and rests just under the top bar while the page reloads.
      style={{ transform: `translate(-50%, ${Math.round(pull - 4)}px)` }}
      role="status"
    >
      <RefreshCw size={20} strokeWidth={2.4} style={refreshing ? undefined : { transform: `rotate(${Math.round(pull * 3)}deg)` }} aria-hidden="true" />
      <span className="visually-hidden">{refreshing ? t("Refreshing…") : ""}</span>
    </div>
  );
}
