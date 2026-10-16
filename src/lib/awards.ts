import type { AwardKey } from "./types";

/** Monthly awards: emoji badge and name. */
export const AWARDS: Record<AwardKey, { emoji: string; title: string; unit: string }> = {
  war: { emoji: "🏆", title: "Top War Scorer", unit: "war points" },
  vials: { emoji: "🧪", title: "Top Vial Donor", unit: "vials" },
  snipes: { emoji: "🎯", title: "Snipe Star", unit: "snipes" },
  saver: { emoji: "💾", title: "Never Missed a Save", unit: "weeks" },
};
