export const CLAN_POINTS_UPDATED = "clan-points-updated";
export type ClanPointsUpdate = { memberId: string; balance?: number };

/** Notify the signed-in member's balance display after a successful reward action. */
export function announceClanPointsUpdate(memberId: string, balance?: number): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<ClanPointsUpdate>(CLAN_POINTS_UPDATED, {
    detail: { memberId, balance },
  }));
}
