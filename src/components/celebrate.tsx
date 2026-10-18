"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { useT } from "@/lib/i18n";
import "./first-visit.css";

/* Celebrations are kept for big moments (a first save, a streak milestone, the whole clan saving),
   so they still feel special. Each shows once, briefly, and never moves for a phone set to reduce
   motion or for the calmer look. */

const EVENT = "turmoil-celebrate";

/** Shows the banner, once per `once` key on this phone (leave it out to always show). */
export function celebrate(message: string, once?: string) {
  if (once) {
    try {
      if (window.localStorage.getItem(`turmoil-celebrated:${once}`)) return;
      window.localStorage.setItem(`turmoil-celebrated:${once}`, "1");
    } catch { /* private mode: show it anyway */ }
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: message }));
}

/** Where celebrations appear: a short banner at the top of the screen. */
export function Celebrations() {
  const t = useT();
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const show = (event: Event) => {
      setMessage((event as CustomEvent<string>).detail);
      clearTimeout(timer);
      timer = setTimeout(() => setMessage(null), 5000);
    };
    window.addEventListener(EVENT, show);
    return () => { window.removeEventListener(EVENT, show); clearTimeout(timer); };
  }, []);
  if (!message) return null;
  return <div className="celebration" role="status">
    <span className="celebration-burst" aria-hidden="true">{Array.from({ length: 10 }, (_, index) => <i key={index} />)}</span>
    <p>{message}</p>
    <button type="button" aria-label={t("Close")} onClick={() => setMessage(null)}><X size={18} /></button>
  </div>;
}
