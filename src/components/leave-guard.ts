"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * While `active` (unsaved changes on the page), asks before leaving: closing or reloading the page
 * (the browser's own prompt) and tapping one of the Hub's links, such as the bottom bar or the menu,
 * which never fire the browser's prompt.
 */
export function useLeaveGuard(active: boolean, message: string) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const beforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    const click = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = (event.target as Element | null)?.closest?.("a[href]");
      if (!(link instanceof HTMLAnchorElement) || link.target === "_blank" || link.hasAttribute("download")) return;
      const url = new URL(link.href, window.location.href);
      const here = window.location.pathname + window.location.search;
      if (url.origin !== window.location.origin || url.pathname + url.search === here) return;
      // Stop the link here, before the app's own navigation sees the tap.
      event.preventDefault();
      event.stopPropagation();
      if (window.confirm(message)) router.push(url.pathname + url.search + url.hash);
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", click, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", click, true);
    };
  }, [active, message, router]);
}
