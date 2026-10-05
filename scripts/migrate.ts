import { loadEnvConfig } from "@next/env";
import { database } from "../src/lib/server/db";

async function main() {
  loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");
  const db = await database();
  console.log(`Database schema ready (${db.dialect}).`);
  await db.close();
}
main().catch((error: unknown) => {
  console.error(
    "Database migration failed:",
    error instanceof Error ? error.name : "UnknownError",
  );
  process.exitCode = 1;
});
