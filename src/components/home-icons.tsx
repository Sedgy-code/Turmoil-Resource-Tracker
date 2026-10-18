/* A filled, game-style stack of coins: Clan Points on Home. */

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
