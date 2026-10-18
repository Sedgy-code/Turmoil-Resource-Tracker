import type { AscensionPillar } from "./types";

/** The four pillars a member can ascend, in the order they're shown. */
export const ASCENSION_PILLARS: readonly AscensionPillar[] = ["forge", "skills", "mounts", "pets"];

/** English names; the interface translates them (listed in i18n/indirect-keys.mjs). */
export const PILLAR_LABELS: Record<AscensionPillar, string> = { forge: "Forge", skills: "Skills", mounts: "Mounts", pets: "Pets" };

/** Sent on the page when someone changes their answer, so the member table can catch up. */
export const ASCENSIONS_UPDATED = "turmoil-ascensions-updated";
