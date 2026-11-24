/**
 * Forging odds and war points per hammer, from the official Forge Master Discord
 * (guides-and-tips: "Forge Upgrades Cost, Time and Forging Probabilities", and its sheet, Nov 2026).
 * The Forge goes to level 35 at Ascensions 0–2 and to level 50 at Ascension 3.
 */
export const FORGE_ERAS = [
  "Primitive", "Medieval", "Early-Modern", "Modern", "Space", "Interstellar",
  "Multiverse", "Quantum", "Underworld", "Divine", "Heroic", "Infinite", "Eternal",
] as const;

/** War points for forging one item of each era, before tech (Clan War Day Actions). */
export const FORGE_ERA_POINTS: readonly number[] = [1, 1, 1, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3];

export const FORGE_MAX_LEVEL = 50;

/** The chance (%) of forging each era (Primitive → Eternal) at forge levels 1–50. */
export const FORGE_ODDS: readonly (readonly number[])[] = [
  [100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [99, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [98, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [96, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [91.5, 8, 0.5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [82, 16, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [64, 32, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [27.8, 64, 8, 0.2, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [13, 70, 16, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [6, 60, 32, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 31.9, 64, 4, 0.1, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 27.5, 64, 8, 0.5, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 8, 75, 16, 1, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 66, 32, 2, 0.05, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 31.7, 64, 4, 0.25, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 21.5, 70, 8, 0.5, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 82.9, 16, 1, 0.05, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 65.7, 32, 2, 0.25, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 31.5, 64, 4, 0.5, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 91, 8, 1, 0.05, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 81.7, 16, 2, 0.25, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 63.5, 32, 4, 0.5, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 27, 64, 8, 1, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 82, 16, 2, 0.02, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 64, 32, 4, 0.05, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 43.8, 50, 6, 0.25, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 31.5, 60, 8, 0.5, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 21, 65, 13, 1, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 6.99, 68, 23, 2, 0.02, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 60, 36, 4, 0.05, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 50.8, 43, 6, 0.25, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 41.5, 50, 8, 0.5, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 28, 58, 13, 1, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 11, 64, 23, 2, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 60, 36, 4, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 56.98, 38, 5, 0.02, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 50.95, 43, 6, 0.05, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 41.75, 50, 8, 0.25, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 28.5, 58, 13, 0.5, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 12, 64, 23, 1, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 68.65, 29.33, 2, 0.02, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 60.73, 35.22, 4, 0.05, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 53.29, 40.46, 6, 0.25, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 47.91, 43.59, 8, 0.5, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 26, 60, 13, 1, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 74.98, 23, 2, 0.02],
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 59.95, 36, 4, 0.05],
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 36.75, 55, 8, 0.25],
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 16.5, 70, 13, 0.5],
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 80, 19, 1],
];

/** Expected points per hammer are kept in millionths of a point, so clan sums stay exact. */
export const FORGE_POINT_SCALE = 1_000_000n;

/** A saved forge level the tables cover (a whole number from 1 to 50), or null. */
export function validForgeLevel(level: unknown): number | null {
  return typeof level === "number" && Number.isInteger(level) && level >= 1 && level <= FORGE_MAX_LEVEL ? level : null;
}

/**
 * Expected war points per hammer at a forge level, before tech, in millionths of a point.
 * The published odds are rounded to two decimals, so each level is weighed by its own total.
 */
const SCALED_POINTS: readonly bigint[] = FORGE_ODDS.map((odds) => {
  const hundredths = odds.map((chance) => BigInt(Math.round(chance * 100)));
  const total = hundredths.reduce((sum, value) => sum + value, 0n);
  const points = hundredths.reduce((sum, value, era) => sum + value * BigInt(FORGE_ERA_POINTS[era]), 0n);
  return (points * FORGE_POINT_SCALE + total / 2n) / total;
});

export function scaledForgePoints(level: number): bigint {
  return SCALED_POINTS[level - 1];
}

/** Expected war points per hammer at a forge level, before tech (e.g. 3 from level 30 up). */
export function forgePointsPerHammer(level: number): number {
  return Number(scaledForgePoints(level)) / Number(FORGE_POINT_SCALE);
}
