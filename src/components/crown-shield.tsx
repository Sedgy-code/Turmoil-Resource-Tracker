/** A shield with a crown: the Clan Points and clan arsenal mark. Drawn like the other line icons. */
export function CrownShield({ size = 18, className }: { size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 21.5s7.5-3.4 7.5-9.9V5.4L12 2.5 4.5 5.4v6.2c0 6.5 7.5 9.9 7.5 9.9Z" />
      <path d="M8.4 14.6 7.6 8.9l2.7 2.2L12 7.6l1.7 3.5 2.7-2.2-.8 5.7Z" />
    </svg>
  );
}
