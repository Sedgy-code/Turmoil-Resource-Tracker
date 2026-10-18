"use client";

import { useId, type ReactNode } from "react";

/*
 * Glossy, glowing pictures for the clan's resources (from JBUC10's design), in the game's colours:
 * green skill tickets, gold mount keys, purple mounts, icy hammers, green Clan Tech Vials and a
 * many-coloured egg. They take the same props as the line icons, so they drop in anywhere.
 */
type Props = { size?: number; className?: string; strokeWidth?: number };

/** Ids for the gradients, unique on the page (an icon can show many times). */
function useIds(...names: string[]) {
  const base = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  return names.map((name) => `${name}-${base}`);
}

function Art({ size = 24, className, glow, children }: { size?: number; className?: string; glow: string; children: ReactNode }) {
  const blur = Math.max(2, Math.round(size / 9));
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      className={`res-icon${className ? ` ${className}` : ""}`}
      style={{ filter: `drop-shadow(0 0 ${blur}px ${glow})` }}
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export function TicketIcon({ size, className }: Props) {
  const [body, star] = useIds("ticket", "ticket-star");
  return (
    <Art size={size} className={className} glow="#2fe46c99">
      <defs>
        <linearGradient id={body} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#a8ffc2" />
          <stop offset=".45" stopColor="#3fe27a" />
          <stop offset="1" stopColor="#11963f" />
        </linearGradient>
        <linearGradient id={star} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#d9ffe6" />
          <stop offset="1" stopColor="#6cf09a" />
        </linearGradient>
      </defs>
      <g transform="rotate(-34 24 24) translate(24 24) scale(1.18) translate(-24 -24)">
        <path d="M9 14h30a2.5 2.5 0 0 1 2.5 2.5V21a3 3 0 0 0 0 6v4.5A2.5 2.5 0 0 1 39 34H9a2.5 2.5 0 0 1-2.5-2.5V27a3 3 0 0 0 0-6v-4.5A2.5 2.5 0 0 1 9 14Z" fill={`url(#${body})`} stroke="#0b5a26" strokeWidth="1.2" />
        <path d="M11 17.5h26v13H11Z" fill="none" stroke="#e8fff0" strokeOpacity=".55" strokeWidth="1.1" strokeDasharray="2.2 1.6" />
        <path d="M24 18.5l1.6 3.9 3.9 1.6-3.9 1.6-1.6 3.9-1.6-3.9-3.9-1.6 3.9-1.6Z" fill={`url(#${star})`} />
        <path d="M9.5 15.5h29" stroke="#fff" strokeOpacity=".6" strokeWidth="1.2" strokeLinecap="round" />
      </g>
    </Art>
  );
}

export function KeyIcon({ size, className }: Props) {
  const [metal] = useIds("key");
  return (
    <Art size={size} className={className} glow="#f2b33c99">
      <defs>
        <linearGradient id={metal} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff6c2" />
          <stop offset=".4" stopColor="#f7c948" />
          <stop offset="1" stopColor="#c0821c" />
        </linearGradient>
      </defs>
      <g transform="rotate(-40 24 24) translate(24 24) scale(1.12) translate(-24 -24)">
        <path fillRule="evenodd" d="M6 24a8.5 8.5 0 0 1 16.4-3.1H40.5a2 2 0 0 1 1.5.7l2 2.4-2 2.4a2 2 0 0 1-1.5.7H39v4.4a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1V27h-2v3a1 1 0 0 1-1 1h-2.6a1 1 0 0 1-1-1v-3h-5A8.5 8.5 0 0 1 6 24Zm5 0a3.5 3.5 0 1 0 7 0 3.5 3.5 0 1 0-7 0Z" fill={`url(#${metal})`} stroke="#8a5a10" strokeWidth="1.1" strokeLinejoin="round" />
        <path d="M23.5 22.4H40" stroke="#fffbe0" strokeOpacity=".75" strokeWidth="1.1" strokeLinecap="round" />
        <path d="M8.6 21.2a6 6 0 0 1 5.2-3.3" stroke="#fffbe0" strokeOpacity=".8" strokeWidth="1.2" strokeLinecap="round" fill="none" />
      </g>
    </Art>
  );
}

/** Mounts: a horseshoe, in the purple of the game's mounts. */
export function HorseshoeIcon({ size, className }: Props) {
  const [metal] = useIds("shoe");
  return (
    <Art size={size} className={className} glow="#a26bffaa">
      <defs>
        <linearGradient id={metal} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f3e2ff" />
          <stop offset=".4" stopColor="#bb84ff" />
          <stop offset="1" stopColor="#6c34c9" />
        </linearGradient>
      </defs>
      <path d="M8.5 7.5h8.6v15.3a6.9 6.9 0 0 0 13.8 0V7.5h8.6v15.3a15.5 15.5 0 0 1-31 0Z" fill={`url(#${metal})`} stroke="#3f1a7a" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M7.2 7.5h11.2v3.4H7.2Zm22.4 0h11.2v3.4H29.6Z" fill="#e7d0ff" stroke="#3f1a7a" strokeWidth="1" />
      <g fill="#3a1670" fillOpacity=".75">
        <circle cx="12.8" cy="15.5" r="1.2" /><circle cx="13.6" cy="23" r="1.2" /><circle cx="16.8" cy="30.2" r="1.2" />
        <circle cx="35.2" cy="15.5" r="1.2" /><circle cx="34.4" cy="23" r="1.2" /><circle cx="31.2" cy="30.2" r="1.2" />
      </g>
      <path d="M10.3 12v10.8a13.6 13.6 0 0 0 6.5 11.6" stroke="#fff" strokeOpacity=".6" strokeWidth="1.3" strokeLinecap="round" fill="none" />
    </Art>
  );
}

/** Hammers, in a cool ice blue. */
export function HammerIcon({ size, className }: Props) {
  const [head, handle] = useIds("hammer", "hammer-handle");
  return (
    <Art size={size} className={className} glow="#3fbfffaa">
      <defs>
        <linearGradient id={head} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f0fbff" />
          <stop offset=".45" stopColor="#8fd8ff" />
          <stop offset="1" stopColor="#2f7fd0" />
        </linearGradient>
        <linearGradient id={handle} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#5b7390" />
          <stop offset=".5" stopColor="#8aa2bd" />
          <stop offset="1" stopColor="#34465c" />
        </linearGradient>
      </defs>
      <g transform="rotate(-42 24 24)">
        <rect x="21.6" y="17" width="4.8" height="27" rx="2.2" fill={`url(#${handle})`} stroke="#1d2a3a" strokeWidth="1" />
        <path d="M21.8 35h4.4M21.8 38.2h4.4M21.8 41.2h4.4" stroke="#1d2a3a" strokeOpacity=".6" strokeWidth="1.1" />
        <rect x="11" y="6" width="26" height="12" rx="2.6" fill={`url(#${head})`} stroke="#1f4f86" strokeWidth="1.2" />
        <rect x="8.6" y="7.6" width="3.2" height="8.8" rx="1" fill="#c9ecff" stroke="#1f4f86" strokeWidth="1" />
        <rect x="36.2" y="7.6" width="3.2" height="8.8" rx="1" fill="#c9ecff" stroke="#1f4f86" strokeWidth="1" />
        <path d="M13 8.6h22" stroke="#fff" strokeOpacity=".85" strokeWidth="1.3" strokeLinecap="round" />
      </g>
    </Art>
  );
}

/** Clan Tech Vials: the green test tube from the Tech Tree screen. */
export function VialIcon({ size, className }: Props) {
  const [liquid, glass] = useIds("vial", "vial-glass");
  return (
    <Art size={size} className={className} glow="#2fe46c99">
      <defs>
        <linearGradient id={liquid} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#2fd36a" />
          <stop offset=".45" stopColor="#8dffb0" />
          <stop offset="1" stopColor="#139a43" />
        </linearGradient>
        <linearGradient id={glass} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#e9f8ff" stopOpacity=".5" />
          <stop offset="1" stopColor="#bfe6ff" stopOpacity=".18" />
        </linearGradient>
      </defs>
      <g transform="rotate(38 24 24)">
        <path d="M18.5 7.5h11v28a5.5 5.5 0 0 1-11 0Z" fill={`url(#${glass})`} stroke="#e4f6ff" strokeWidth="1.4" />
        <path d="M18.5 19.5h11v16a5.5 5.5 0 0 1-11 0Z" fill={`url(#${liquid})`} />
        <path d="M18.5 19.5c2-1.4 4-1.4 5.5 0s3.6 1.4 5.5 0" fill="none" stroke="#c9ffd9" strokeWidth="1.2" />
        <rect x="16.5" y="4.6" width="15" height="4" rx="1.6" fill="#7fd0ff" stroke="#2c6fa3" strokeWidth="1" />
        <path d="M21 11v24" stroke="#fff" strokeOpacity=".75" strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="25.5" cy="28" r="1.4" fill="#fff" fillOpacity=".75" />
        <circle cx="23.5" cy="34" r="1" fill="#fff" fillOpacity=".7" />
      </g>
    </Art>
  );
}

/** Eggs and pets: a purple egg with gold and pink bands, sparkling. */
export function EggIcon({ size, className }: Props) {
  const [shell, clip] = useIds("egg", "egg-clip");
  const outline = "M24 5c-7.6 0-14 11.3-14 21.4C10 35.6 16.2 43 24 43s14-7.4 14-16.6C38 16.3 31.6 5 24 5Z";
  return (
    <Art size={size} className={className} glow="#ff4f9aaa">
      <defs>
        <radialGradient id={shell} cx=".38" cy=".3" r=".8">
          <stop offset="0" stopColor="#e9c8ff" />
          <stop offset=".45" stopColor="#9a4dff" />
          <stop offset="1" stopColor="#52179e" />
        </radialGradient>
        <clipPath id={clip}><path d={outline} /></clipPath>
      </defs>
      <path d={outline} fill={`url(#${shell})`} />
      <g clipPath={`url(#${clip})`}>
        <path d="M6 21c5-4 9 3 14-1s9-6 13-2 6 2 10-1v6c-4 3-6 1-10-1s-8 0-13 3-9-3-14 2Z" fill="#ffc94a" />
        <path d="M6 33c5-3 9 2 14-1s9-4 13-1 6 1 10-1v5c-4 2-6 1-10-1s-8 0-13 2-9-2-14 1Z" fill="#ff5fa2" />
      </g>
      <path d={outline} fill="none" stroke="#ff8fc4" strokeOpacity=".9" strokeWidth="1.3" />
      <ellipse cx="18.5" cy="14" rx="2.4" ry="4.2" fill="#fff" fillOpacity=".55" transform="rotate(-24 18.5 14)" />
      <path d="M40 7l.9 2.3 2.3.9-2.3.9-.9 2.3-.9-2.3-2.3-.9 2.3-.9Z M7.5 36l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7Z" fill="#fff" />
    </Art>
  );
}

/** Eggshells: the cracked bottom half of the egg, in cream. */
export function EggshellIcon({ size, className }: Props) {
  const [shell] = useIds("eggshell");
  return (
    <Art size={size} className={className} glow="#ffb3d999">
      <defs>
        <linearGradient id={shell} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fffaf0" />
          <stop offset=".55" stopColor="#f7dfc4" />
          <stop offset="1" stopColor="#d9a77f" />
        </linearGradient>
      </defs>
      <path d="M9.6 24.5 14 21l3.6 4.2 3.8-4.6 3.6 4.4 3.8-4.4 3.6 4.6L36 21l2.4 3.5c.6 1.6.9 3.2.9 4.9C39.3 37.6 32.5 43 24 43S8.7 37.6 8.7 29.4c0-1.7.3-3.3.9-4.9Z" fill={`url(#${shell})`} stroke="#8a5a3a" strokeWidth="1.1" strokeLinejoin="round" />
      <path d="M12.2 30.5c.6 4.4 4 7.8 8.6 9" stroke="#fff" strokeOpacity=".85" strokeWidth="1.5" strokeLinecap="round" fill="none" />
      <path d="M17 14.5l3.6 3.4-2.8 1.2Zm12 1.5 1.8-4.4 2 3Z" fill="#f7dfc4" stroke="#8a5a3a" strokeWidth=".9" strokeLinejoin="round" />
    </Art>
  );
}
