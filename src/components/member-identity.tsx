"use client";

import { useEffect, useState } from "react";
import { cosmeticItem, equippedCosmetics } from "@/lib/dew";
import type { Member } from "@/lib/types";
import { SnipeBadge, AwardBadges } from "./recognition";
import { useT } from "@/lib/i18n";

type IdentityMember = Pick<Member, "username" | "avatarUrl" | "badge" | "cosmetics"> & { id?: string; holidayUntil?: string | null };

/** Cosmetic styles come only from the trusted reward catalog. Snipe attendees also get a 🎯 count. */
export function MemberName({ member }: { member: IdentityMember }) {
  const t = useT();
  const slots = equippedCosmetics(member);
  const badge = cosmeticItem(slots.badge, "badge");
  const accent = cosmeticItem(slots.accent, "accent");
  return (
    <span className={`member-name${accent?.style ? ` cosmetic-accent-${accent.style}` : ""}`}>
      <span className="member-name-text">{member.username}</span>
      {badge && <span className="member-cosmetic" role="img" title={t(badge.name)} aria-label={t(badge.name)}>{badge.symbol}</span>}
      {member.id && <SnipeBadge memberId={member.id} />}
      {member.id && <AwardBadges memberId={member.id} />}
      {member.holidayUntil && <span className="member-holiday" role="img" title={t("Away until {date}", { date: member.holidayUntil })} aria-label={t("Away until {date}", { date: member.holidayUntil })}>🏖️</span>}
    </span>
  );
}

export function MemberTitle({ member }: { member: IdentityMember }) {
  const t = useT();
  const title = cosmeticItem(equippedCosmetics(member).title, "title");
  return title ? <span className="member-title">{t(title.name)}</span> : null;
}

export function MemberAvatar({ member, small = false }: { member: IdentityMember; small?: boolean }) {
  const t = useT();
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [member.avatarUrl]);
  const hue = [...member.username].reduce((sum, character) => sum + character.charCodeAt(0), 0) % 360;
  const frame = cosmeticItem(equippedCosmetics(member).frame, "frame");
  return (
    <span
      className={`avatar${small ? " small" : ""}${frame?.style ? ` cosmetic-frame-${frame.style}` : ""}`}
      style={{ background: `hsl(${hue} 22% 25%)`, color: `hsl(${hue} 55% 80%)` }}
      title={frame ? t(frame.name) : undefined}
    >
      {member.avatarUrl && !failed ? (
        <img src={member.avatarUrl} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      ) : member.username.slice(0, 2).toUpperCase()}
    </span>
  );
}
