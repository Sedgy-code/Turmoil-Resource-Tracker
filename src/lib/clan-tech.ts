/** The Clan Tech tree: every node, its max level and how high Turmoil puts it (1 = fund first). */
export type TechSection = "Clan War" | "Clan Tech Potions" | "Power" | "Egg Timers" | "Special" | "Clan Missions" | "Dungeons";
export interface TechNode { key: string; name: string; section: TechSection; max: number; priority: 1 | 2 | 3 | 4 | 5; effect: string }

const node = (section: TechSection, name: string, max: number, priority: TechNode["priority"], effect: string): TechNode =>
  ({ key: name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""), name, section, max, priority, effect });

export const TECH_NODES: TechNode[] = [
  ...[1, 2, 3, 4, 5, 6].map((day) => node("Clan War", `War Points On Day ${day}`, 10, 1, "+4% war points per level")),
  ...["Forging", "Skill Summon", "Skill Upgrade", "Tech Upgrade", "Forge Spend", "Dungeon Key", "Egg Hatch", "Pet Merge", "Mount Summon", "Mount Merge"]
    .map((source) => node("Clan War", `War Points From ${source}`, 10, 1, "+4% war points per level")),
  node("Clan War", "Clan War Damage", 100, 2, "+100% damage in Clan War per level"),
  node("Clan War", "Clan War Health", 100, 2, "+100% health in Clan War per level"),
  node("Clan War", "Personal War Rewards", 10, 4, "+1% rewards per level"),
  node("Clan War", "Clan War Win Rewards", 10, 4, "+1% rewards per level"),
  node("Clan War", "Clan War Lose Rewards", 10, 4, "+1% rewards per level"),
  node("Clan Tech Potions", "Tech Race Score Multiplier", 20, 3, "+5% race score per level"),
  node("Clan Tech Potions", "Tech Race Reward Multiplier", 20, 3, "+5% race rewards per level"),
  ...["Missions", "Personal War", "Clan War Win", "Clan War Lose"].map((source) => node("Clan Tech Potions", `Vials From ${source}`, 20, 5, "+5% vials per level")),
  ...["Weapon", "Helmet", "Body", "Shoe", "Glove", "Belt", "Necklace", "Ring"].map((slot) => node("Power", `${slot} Bonus`, 20, 5, "+5% per level")),
  node("Power", "Skill Damage", 20, 5, "+5% per level"),
  node("Power", "Pet Bonus Damage", 20, 5, "+5% per level"),
  node("Power", "Pet Bonus Health", 20, 5, "+5% per level"),
  node("Power", "Mount Damage", 20, 5, "+5% per level"),
  node("Power", "Mount Health", 20, 5, "+5% per level"),
  ...["Common", "Rare", "Epic", "Legendary", "Ultimate", "Mythic"].map((rarity) => node("Egg Timers", `${rarity} Egg Timer`, 60, 5, "Faster hatching")),
  node("Special", "Auto Forge", 2, 5, "Forges for you"),
  node("Special", "Forge Animation Speed", 20, 5, "+5% per level"),
  node("Special", "Player Move Speed", 20, 5, "+5% per level"),
  node("Special", "Player Attack Range", 3, 5, "+100% per level"),
  node("Clan Missions", "Mission Damage", 20, 5, "+5% per level"),
  node("Clan Missions", "Mission Health", 20, 5, "+5% per level"),
  node("Clan Missions", "Mission Rewards", 10, 5, "+1% per level"),
  ...["Hammer Thief", "Ghost Town", "Invasion", "Zombie Rush"].flatMap((dungeon) => [
    node("Dungeons", `${dungeon} Dungeon Damage`, 10, 5, "+5% per level"),
    node("Dungeons", `${dungeon} Dungeon Health`, 10, 5, "+5% per level"),
  ]),
];

export const TECH_SECTIONS: TechSection[] = ["Clan War", "Clan Tech Potions", "Power", "Egg Timers", "Special", "Clan Missions", "Dungeons"];
export const TECH_KEYS = new Set(TECH_NODES.map((entry) => entry.key));

/** Unfinished nodes in the order Turmoil funds them (closest to done first within a tier). */
export function nextToFund(levels: Record<string, number>, count = 6): TechNode[] {
  return TECH_NODES
    .filter((entry) => (levels[entry.key] ?? 0) < entry.max)
    .sort((a, b) => a.priority - b.priority || ((levels[b.key] ?? 0) / b.max) - ((levels[a.key] ?? 0) / a.max))
    .slice(0, count);
}

export function progress(levels: Record<string, number>, nodes = TECH_NODES): number {
  const total = nodes.reduce((sum, entry) => sum + entry.max, 0);
  const done = nodes.reduce((sum, entry) => sum + Math.min(entry.max, levels[entry.key] ?? 0), 0);
  return total ? done / total : 0;
}
