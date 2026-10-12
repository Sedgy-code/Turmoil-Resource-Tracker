import type { CosmeticCategory, DewItem, EquippedCosmetics } from "./types";

export const COSMETIC_CATEGORIES: CosmeticCategory[] = ["badge", "title", "accent", "frame"];
export const COSMETIC_CATEGORY_LABELS: Record<CosmeticCategory, string> = {
  badge: "Badge",
  title: "Title",
  accent: "Name accent",
  frame: "Avatar frame",
};
export const REWARD_TIERS = [10, 25, 50, 75, 100] as const;
export const EMPTY_EQUIPPED_COSMETICS: EquippedCosmetics = {
  badge: null,
  title: null,
  accent: null,
  frame: null,
};

export const DEW_ITEMS: DewItem[] = [
  // Keep the original IDs and prices so existing purchases and browser tabs stay valid.
  { id: "forge-scout", name: "Forge Scout", symbol: "🔰", cost: 2, category: "badge", legacy: true },
  { id: "anvil", name: "Forge Master", symbol: "⚒️", cost: 2, category: "badge", legacy: true },
  { id: "war-ready", name: "War Ready", symbol: "🛡️", cost: 3, category: "badge", legacy: true },
  { id: "clan-champion", name: "Clan Champion", symbol: "🏆", cost: 5, category: "badge", legacy: true },
  { id: "phoenix", name: "Phoenix", symbol: "🔥", cost: 5, category: "badge", legacy: true },
  { id: "emerald", name: "Emerald Heart", symbol: "💚", cost: 3, category: "badge", legacy: true },
  { id: "egg-whisperer", name: "Egg Whisperer", symbol: "🥚", cost: 10, category: "badge" },
  { id: "keeper-of-the-bank", name: "Keeper of the Bank", symbol: "📜", cost: 10, category: "title" },
  { id: "emerald-accent", name: "Emerald", symbol: "✦", cost: 10, category: "accent", style: "emerald" },
  { id: "emerald-frame", name: "Emerald Ring", symbol: "◉", cost: 10, category: "frame", style: "emerald" },
  { id: "snipe-specialist", name: "Snipe Specialist", symbol: "🎯", cost: 25, category: "badge" },
  { id: "mount-tamer", name: "Mount Tamer", symbol: "📜", cost: 25, category: "title" },
  { id: "ice-blue-accent", name: "Ice Blue", symbol: "✦", cost: 25, category: "accent", style: "frost" },
  { id: "frost-frame", name: "Frost Guard", symbol: "◉", cost: 25, category: "frame", style: "frost" },
  { id: "hammer-hero", name: "Hammer Hero", symbol: "🔨", cost: 50, category: "badge" },
  { id: "war-architect", name: "War Architect", symbol: "📜", cost: 50, category: "title" },
  { id: "ember-accent", name: "Ember", symbol: "✦", cost: 50, category: "accent", style: "ember" },
  { id: "gold-forge-frame", name: "Gold Forge", symbol: "◉", cost: 50, category: "frame", style: "gold" },
  { id: "clan-vanguard", name: "Clan Vanguard", symbol: "⚔️", cost: 75, category: "badge" },
  { id: "turmoil-legend", name: "Turmoil Legend", symbol: "📜", cost: 75, category: "title" },
  { id: "royal-violet-accent", name: "Royal Violet", symbol: "✦", cost: 75, category: "accent", style: "royal" },
  { id: "phoenix-crown-frame", name: "Phoenix Crown", symbol: "◉", cost: 75, category: "frame", style: "phoenix" },
  { id: "celestial-crest", name: "Celestial Crest", symbol: "🌟", cost: 100, category: "badge" },
  { id: "eternal-champion", name: "Eternal Champion", symbol: "📜", cost: 100, category: "title" },
  { id: "celestial-accent", name: "Celestial", symbol: "✦", cost: 100, category: "accent", style: "celestial" },
  { id: "celestial-halo-frame", name: "Celestial Halo", symbol: "◉", cost: 100, category: "frame", style: "celestial" },
];

/** Stored IDs may come from an older client; only catalog items can become visible cosmetics. */
export function cosmeticItem(itemId: unknown, category: CosmeticCategory): DewItem | undefined {
  return DEW_ITEMS.find((item) => item.id === itemId && item.category === category);
}

export function equippedCosmetics(member: { badge?: string | null; cosmetics?: Partial<EquippedCosmetics> }): EquippedCosmetics {
  const slots = { ...EMPTY_EQUIPPED_COSMETICS, ...member.cosmetics, badge: member.cosmetics?.badge !== undefined ? member.cosmetics.badge : member.badge ?? null };
  return Object.fromEntries(COSMETIC_CATEGORIES.map((category) => [category, cosmeticItem(slots[category], category)?.id ?? null])) as EquippedCosmetics;
}
