import { randomUUID } from "node:crypto";
import {
  EMPTY_RESOURCES,
  currentWeek,
  shiftWeek,
  type ResourceValues,
} from "../resources";
import { database } from "./db";

const DEMO_NAMES = [
  "Kael",
  "Nyx",
  "Ragnar",
  "Vex",
  "Astrid",
  "Fenrir",
  "Echo",
  "Sylas",
  "Nova",
  "Dante",
  "Raven",
  "Orion",
  "Mika",
  "Thorne",
  "Zara",
  "Jax",
];
declare global {
  var turmoilDemoSeed: Promise<void> | undefined;
}

export async function seedDemo(): Promise<void> {
  if (!globalThis.turmoilDemoSeed) {
    globalThis.turmoilDemoSeed = (async () => {
      const db = await database();
      await db.transaction(async (tx) => {
        const existing = await tx.query(
          "SELECT id FROM app_members WHERE discord_id = $1",
          ["demo-kael"],
        );
        if (existing.length) return;
        const week = currentWeek();
        const members = DEMO_NAMES.map((name, index) => ({
          id: randomUUID(),
          name,
          index,
        }));
        for (const member of members) {
          await tx.query(
            "INSERT INTO app_members (id, discord_id, username, avatar_url, role, joined_at) VALUES ($1,$2,$3,$4,$5,NOW() - INTERVAL '42 days')",
            [
              member.id,
              `demo-${member.name.toLowerCase()}`,
              member.name,
              `https://cdn.discordapp.com/embed/avatars/${member.index % 6}.png`,
              member.index === 0 ? "ADMIN" : "MEMBER",
            ],
          );
        }
        for (let offset = 0; offset > -4; offset--) {
          for (const { id, index, name } of members) {
            if (offset === 0 && index >= 12) continue;
            const multiplier = 1 + index * 0.09 + offset * 0.04;
            const values: ResourceValues = {
              ...EMPTY_RESOURCES,
              skillTickets: Math.floor((2100 + (index % 5) * 640) * multiplier),
              eggsPetsTotal:
                [180, 68, 34, 15, 5, 2, 34, 18, 9, 5].reduce((total, amount) => total + Math.floor(amount * multiplier), 0)
                + index % 3 + index % 2,
              mountKeys: Math.floor(126 * multiplier),
              mountsToMerge: Math.floor(12 * multiplier),
              hammers: Math.floor(1240 * multiplier),
              potions: Math.floor(380 * multiplier),
            };
            const updated = new Date(
              Date.now() - (index * 37 + 7) * 60 * 1000 + offset * 7 * 86400000,
            ).toISOString();
            await tx.query(
              "INSERT INTO resource_entries (id,member_id,week_start,resources,notes,updated_at,updated_by) VALUES ($1,$2,$3,$4::jsonb,$5,$6,$2)",
              [
                randomUUID(),
                id,
                shiftWeek(week, offset),
                JSON.stringify(values),
                index === 0
                  ? "Saving for the next clan event."
                  : index % 4 === 0
                    ? `${name} is ready for the next push.`
                    : "",
                updated,
              ],
            );
            if (offset === 0)
              await tx.query(
                "UPDATE app_members SET last_updated_at = $2 WHERE id = $1",
                [id, updated],
              );
          }
        }
      });
    })().catch((error) => {
      globalThis.turmoilDemoSeed = undefined;
      throw error;
    });
  }
  await globalThis.turmoilDemoSeed;
}
