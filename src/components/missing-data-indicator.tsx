"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CircleAlert } from "lucide-react";
import type { MemberPlanningIssues } from "@/lib/planning-completeness";
import styles from "./missing-data-indicator.module.css";
import { useT } from "@/lib/i18n";

export function MissingDataIndicator({ members, label, accessibleLabel, compact = false }: {
  members: MemberPlanningIssues[];
  label: string;
  accessibleLabel?: string;
  compact?: boolean;
}) {
  const t = useT();
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const pinned = useRef(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number; maxHeight: number } | null>(null);
  const cancelClose = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }, []);
  const close = useCallback(() => {
    cancelClose();
    pinned.current = false;
    setOpen(false);
    setPosition(null);
  }, [cancelClose]);
  const show = () => { cancelClose(); setOpen(true); };
  const delayClose = () => {
    cancelClose();
    if (!pinned.current && !button.current?.matches(":focus-visible")) closeTimer.current = setTimeout(close, 160);
  };
  useEffect(() => cancelClose, [cancelClose]);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      if (!button.current || !popup.current) return;
      const trigger = button.current.getBoundingClientRect();
      const margin = 12;
      const below = window.innerHeight - trigger.bottom - margin - 8;
      const above = trigger.top - margin - 8;
      const desiredHeight = Math.min(popup.current.scrollHeight, 320);
      const useBelow = below >= desiredHeight || below >= above;
      const maxHeight = Math.max(60, Math.min(320, useBelow ? below : above));
      const height = Math.min(desiredHeight, maxHeight);
      const width = popup.current.getBoundingClientRect().width;
      setPosition({
        left: Math.max(margin, Math.min(trigger.left, window.innerWidth - width - margin)),
        top: Math.max(margin, useBelow ? trigger.bottom + 8 : trigger.top - height - 8),
        maxHeight,
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !button.current?.contains(event.target) && !popup.current?.contains(event.target)) close();
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open, close]);

  if (!members.length) return null;
  return <>
    <button
      ref={button}
      type="button"
      className={`${styles.indicator} ${compact ? styles.compact : "summon-warning"}`}
      aria-label={accessibleLabel}
      aria-expanded={open}
      aria-controls={open ? id : undefined}
      aria-describedby={open ? id : undefined}
      onPointerEnter={(event) => { if (event.pointerType === "mouse") show(); }}
      onPointerLeave={(event) => { if (event.pointerType === "mouse") delayClose(); }}
      onFocus={(event) => { if (event.currentTarget.matches(":focus-visible")) show(); }}
      onBlur={close}
      onClick={() => { pinned.current = !pinned.current; if (pinned.current) show(); else close(); }}
    ><CircleAlert size={compact ? 12 : 13} aria-hidden="true" /><span>{label}</span></button>
    {open && createPortal(<div
      ref={popup}
      id={id}
      role="tooltip"
      className={styles.popup}
      style={{ left: position?.left ?? 0, top: position?.top ?? 0, maxHeight: position?.maxHeight ?? 320, visibility: position ? "visible" : "hidden" }}
      onPointerEnter={cancelClose}
      onPointerLeave={delayClose}
    >
      <strong className={styles.heading}>{t("Members with missing numbers")}</strong>
      <p>{t("These numbers are needed to count all war points.")}</p>
      <ul>{members.map((member) => <li key={member.memberId}>
        <strong>{member.username}</strong>
        <span>{member.issues.map((issue) => t(issue.label)).join(" · ")}</span>
      </li>)}</ul>
    </div>, document.body)}
  </>;
}
