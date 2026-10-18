/* Filled, game-style pictures for Home: a stack of coins, and the four things members ascend. */

type IconProps = { size?: number };

function Svg({ size = 18, children }: IconProps & { children: React.ReactNode }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">{children}</svg>;
}

/** A stack of three coins. The coin faces use the text colour, the edges use --coin-edge. */
export function CoinStack({ size }: IconProps) {
  const coin = (y: number) => <g key={y}>
    <path d={`M5 ${y}v3.2a7 2.4 0 0 0 14 0V${y}Z`} opacity=".72" stroke="var(--coin-edge, #000)" strokeWidth="1.1" strokeLinejoin="round" />
    <ellipse cx="12" cy={y} rx="7" ry="2.4" stroke="var(--coin-edge, #000)" strokeWidth="1.1" />
  </g>;
  return <Svg size={size}>{[14.6, 10.4, 6.2].map(coin)}</Svg>;
}

export function ForgeHammer({ size }: IconProps) {
  return <Svg size={size}>
    <g transform="rotate(-45 12 12)">
      <rect x="10.9" y="8.6" width="2.2" height="13.4" rx="1.1" />
      <path d="M6.2 3.4h11.6a1.4 1.4 0 0 1 1.4 1.4v3.2a1.4 1.4 0 0 1-1.4 1.4H6.2A1.4 1.4 0 0 1 4.8 8V4.8a1.4 1.4 0 0 1 1.4-1.4Z" />
    </g>
  </Svg>;
}

export function SkillStar({ size }: IconProps) {
  return <Svg size={size}>
    <path d="m12 2.9 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 16.9l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9Z" fillOpacity=".28" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
  </Svg>;
}

export function MountHorse({ size }: IconProps) {
  return <Svg size={size}>
    <path fillRule="evenodd" d="M7.5 21C7.8 18.6 8.6 16.9 9.8 15.6 8.3 15.9 6.6 15.6 5.3 14.8 4.1 14.1 3.6 12.9 4.3 11.9L8.6 7.6C9.3 6.2 10.3 5.1 11.6 4.4L11.4 2.2 13.6 3.9C17.6 4.2 20.4 7.6 20.4 12.4 20.4 15.6 19.8 18.4 19 21ZM11.55 8.6A.95.95 0 1 0 9.65 8.6.95.95 0 0 0 11.55 8.6Z" />
  </Svg>;
}

export function PetPaw({ size }: IconProps) {
  return <Svg size={size}>
    <path d="M12 12.4c-2.6 0-5.2 3.2-5.2 5.6 0 1.6 1.2 2.5 2.6 2.5 1.1 0 1.7-.6 2.6-.6s1.5.6 2.6.6c1.4 0 2.6-.9 2.6-2.5 0-2.4-2.6-5.6-5.2-5.6Z" />
    <ellipse cx="5.4" cy="10.9" rx="1.9" ry="2.4" transform="rotate(-22 5.4 10.9)" />
    <ellipse cx="9.2" cy="6.5" rx="2" ry="2.6" transform="rotate(-8 9.2 6.5)" />
    <ellipse cx="14.8" cy="6.5" rx="2" ry="2.6" transform="rotate(8 14.8 6.5)" />
    <ellipse cx="18.6" cy="10.9" rx="1.9" ry="2.4" transform="rotate(22 18.6 10.9)" />
  </Svg>;
}
