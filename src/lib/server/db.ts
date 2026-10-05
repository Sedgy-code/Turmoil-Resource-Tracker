import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool, type PoolClient } from "pg";
import { PGlite } from "@electric-sql/pglite";
import { ApiError } from "./errors";
import { isDemo } from "./config";
import { SCHEMA_SQL } from "./schema";

export interface SqlConnection {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<T[]>;
}
export interface Database extends SqlConnection {
  transaction<T>(work: (connection: SqlConnection) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  dialect: "postgres" | "pglite";
}

function pgConnection(client: Pool | PoolClient): SqlConnection {
  return {
    async query<T extends Record<string, unknown>>(
      sql: string,
      params: unknown[] = [],
    ) {
      return (await client.query<T>(sql, params)).rows;
    },
  };
}

export async function openDatabase(
  options: { url?: string; localPath?: string } = {},
): Promise<Database> {
  if (options.url) {
    const pool = new Pool({
      connectionString: options.url,
      max: 5,
      connectionTimeoutMillis: 10000,
    });
    const connection = pgConnection(pool);
    return {
      ...connection,
      dialect: "postgres",
      async transaction<T>(work: (connection: SqlConnection) => Promise<T>) {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const result = await work(pgConnection(client));
          await client.query("COMMIT");
          return result;
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
      },
      async close() {
        await pool.end();
      },
    };
  }
  if (process.env.NODE_ENV === "production")
    throw new ApiError(
      503,
      "A PostgreSQL database is required in production.",
      "DATABASE_NOT_CONFIGURED",
    );
  const path = options.localPath;
  if (path && path !== "memory://") await mkdir(path, { recursive: true });
  const pg = new PGlite(path ?? "memory://");
  await pg.waitReady;
  return {
    dialect: "pglite",
    async query<T extends Record<string, unknown>>(
      sql: string,
      params: unknown[] = [],
    ) {
      return (await pg.query<T>(sql, params)).rows;
    },
    async transaction<T>(work: (connection: SqlConnection) => Promise<T>) {
      return pg.transaction(async (tx) =>
        work({
          async query<U extends Record<string, unknown>>(
            sql: string,
            params: unknown[] = [],
          ) {
            return (await tx.query<U>(sql, params)).rows;
          },
        }),
      );
    },
    async close() {
      await pg.close();
    },
  };
}

export async function initializeSchema(database: Database): Promise<void> {
  // Both drivers support this SQL; PostgreSQL locks keep concurrent cold starts safe.
  await database.transaction(async (tx) => {
    if (database.dialect === "postgres")
      await tx.query("SELECT pg_advisory_xact_lock(74190318)");
    for (const statement of SCHEMA_SQL.split(";")
      .map((value) => value.trim())
      .filter(Boolean))
      await tx.query(statement);
  });
}

declare global {
  var turmoilDatabase: Promise<Database> | undefined;
}

export async function database(): Promise<Database> {
  if (!globalThis.turmoilDatabase) {
    globalThis.turmoilDatabase = (async () => {
      const demo = isDemo();
      if (process.env.NODE_ENV === "production" && !process.env.DATABASE_URL)
        throw new ApiError(
          503,
          "A PostgreSQL database is required in production.",
          "DATABASE_NOT_CONFIGURED",
        );
      // A production build must never trace a dynamic development data directory.
      const db =
        process.env.NODE_ENV === "production"
          ? await openDatabase({ url: process.env.DATABASE_URL })
          : await openDatabase({
              url: demo ? undefined : process.env.DATABASE_URL,
              localPath: resolve(
                /* turbopackIgnore: true */ process.env.LOCAL_DATABASE_PATH ||
                  `.data/${demo ? "turmoil-demo" : "turmoil"}`,
              ),
            });
      await initializeSchema(db);
      return db;
    })().catch((error) => {
      globalThis.turmoilDatabase = undefined;
      throw error;
    });
  }
  return globalThis.turmoilDatabase;
}

export async function lockAdministration(
  tx: SqlConnection,
  dialect: Database["dialect"],
): Promise<void> {
  if (dialect === "postgres")
    await tx.query("SELECT pg_advisory_xact_lock(74190319)");
  // PGlite executes transactions serially in the one shared local instance.
}
