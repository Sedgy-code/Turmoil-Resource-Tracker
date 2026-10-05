import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import type { Member } from "../types";
import { database, lockAdministration, type Database } from "./db";
import { decrypt, encrypt, hashToken, randomToken } from "./crypto";
import { isDemo, requireConfiguration } from "./config";
import {
  assertGuildMembership,
  avatarUrl,
  refreshTokens,
  type DiscordTokens,
  type DiscordUser,
} from "./discord";
import { ApiError } from "./errors";
import { iso, memberFromRow } from "./mappers";
import { seedDemo } from "./demo";

export const SESSION_COOKIE = "turmoil_session";
export const OAUTH_COOKIE = "turmoil_oauth";
export const SESSION_SECONDS = 7 * 24 * 60 * 60;
export const cookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
});

export async function registerDiscordMember(
  user: DiscordUser,
  db: Database | undefined = undefined,
): Promise<Member> {
  db ??= await database();
  return db.transaction(async (tx) => {
    await lockAdministration(tx, db.dialect);
    const existing = await tx.query(
      "SELECT * FROM app_members WHERE discord_id = $1",
      [user.id],
    );
    if (existing.length) {
      if (!existing[0].active)
        throw new ApiError(
          403,
          "Your tracker account has been deactivated. Contact an administrator.",
          "ACCOUNT_INACTIVE",
        );
      const updated = await tx.query(
        "UPDATE app_members SET username = $2, avatar_url = $3 WHERE id = $1 RETURNING *",
        [existing[0].id, user.username, avatarUrl(user)],
      );
      return memberFromRow(updated[0]);
    }
    const administrators = await tx.query(
      "SELECT id FROM app_members WHERE role = 'ADMIN' AND active = TRUE LIMIT 1",
    );
    const designated = process.env.INITIAL_ADMIN_DISCORD_ID;
    const initialAdmin =
      !administrators.length && (designated ? designated === user.id : true);
    const rows = await tx.query(
      "INSERT INTO app_members (id,discord_id,username,avatar_url,role) VALUES ($1,$2,$3,$4,$5) RETURNING *",
      [
        randomUUID(),
        user.id,
        user.username,
        avatarUrl(user),
        initialAdmin ? "ADMIN" : "MEMBER",
      ],
    );
    return memberFromRow(rows[0]);
  });
}

export async function createSession(
  member: Member,
  tokens: DiscordTokens,
  db: Database | undefined = undefined,
): Promise<string> {
  db ??= await database();
  const token = randomToken();
  await db.query("DELETE FROM auth_sessions WHERE expires_at < NOW()");
  await db.query(
    "INSERT INTO auth_sessions (token_hash,member_id,encrypted_access_token,encrypted_refresh_token,oauth_expires_at,expires_at) VALUES ($1,$2,$3,$4,$5,$6)",
    [
      hashToken(token),
      member.id,
      encrypt(tokens.access_token),
      encrypt(tokens.refresh_token),
      new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      new Date(Date.now() + SESSION_SECONDS * 1000).toISOString(),
    ],
  );
  return token;
}

export async function authenticatedMember(
  token?: string,
  dependencies: { db?: Database; fetcher?: typeof fetch } = {},
): Promise<Member | null> {
  if (isDemo()) {
    await seedDemo();
    const rows = await (
      await database()
    ).query(
      "SELECT * FROM app_members WHERE discord_id = 'demo-kael' AND active = TRUE",
    );
    return rows.length ? memberFromRow(rows[0]) : null;
  }
  if (!token) return null;
  requireConfiguration();
  const db = dependencies.db ?? (await database());
  const tokenHash = hashToken(token);
  const result = await db.transaction(
    async (tx): Promise<{ member: Member | null; error?: ApiError }> => {
      // Serialize refreshes so concurrent requests cannot rotate the same refresh token twice.
      const sessions = await tx.query(
        "SELECT s.*, m.* FROM auth_sessions s JOIN app_members m ON m.id = s.member_id WHERE s.token_hash = $1 AND s.expires_at > NOW() AND m.active = TRUE FOR UPDATE OF s",
        [tokenHash],
      );
      if (!sessions.length) return { member: null };
      const session = sessions[0];
      if (
        Date.now() - new Date(iso(session.membership_checked_at)!).getTime() <
        5 * 60 * 1000
      )
        return { member: memberFromRow(session) };
      try {
        let accessToken = decrypt(String(session.encrypted_access_token));
        if (
          new Date(iso(session.oauth_expires_at)!).getTime() <=
          Date.now() + 60000
        ) {
          const tokens = await refreshTokens(
            decrypt(String(session.encrypted_refresh_token)),
            dependencies.fetcher,
          );
          accessToken = tokens.access_token;
          await tx.query(
            "UPDATE auth_sessions SET encrypted_access_token = $2, encrypted_refresh_token = $3, oauth_expires_at = $4 WHERE token_hash = $1",
            [
              tokenHash,
              encrypt(tokens.access_token),
              encrypt(tokens.refresh_token),
              new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
            ],
          );
        }
        await assertGuildMembership(accessToken, dependencies.fetcher);
        await tx.query(
          "UPDATE auth_sessions SET membership_checked_at = NOW() WHERE token_hash = $1",
          [tokenHash],
        );
      } catch (error) {
        // Transient Discord failures fail closed, while keeping the session available to retry.
        if (error instanceof ApiError && error.status === 503)
          return { member: null, error };
        await tx.query("DELETE FROM auth_sessions WHERE token_hash = $1", [
          tokenHash,
        ]);
        return error instanceof ApiError
          ? { member: null, error }
          : { member: null };
      }
      return { member: memberFromRow(session) };
    },
  );
  if (result.error) throw result.error;
  return result.member;
}

export async function currentMember(): Promise<Member | null> {
  return authenticatedMember((await cookies()).get(SESSION_COOKIE)?.value);
}
export async function requireMember(): Promise<Member> {
  const member = await currentMember();
  if (!member)
    throw new ApiError(
      401,
      "Sign in with Discord to access the tracker.",
      "UNAUTHENTICATED",
    );
  return member;
}
export async function revokeSession(token?: string): Promise<void> {
  if (token && !isDemo())
    await (
      await database()
    ).query("DELETE FROM auth_sessions WHERE token_hash = $1", [
      hashToken(token),
    ]);
}
