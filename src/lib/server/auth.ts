import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import type { Member } from "../types";
import { database, lockAdministration, type Database, type SqlConnection } from "./db";
import { decrypt, encrypt, hashToken, randomToken } from "./crypto";
import { isDemo, requireConfiguration } from "./config";
import {
  assertGuildMembership,
  discordProfile,
  refreshTokens,
  type DiscordMembership,
  type DiscordTokens,
  type DiscordUser,
} from "./discord";
import { ApiError } from "./errors";
import { iso, memberFromRow } from "./mappers";
import { seedDemo } from "./demo";

export const SESSION_COOKIE = "turmoil_session";
export const OAUTH_COOKIE = "turmoil_oauth";
// Remember this browser for 180 days after its most recent validated visit.
export const SESSION_SECONDS = 180 * 24 * 60 * 60;
// How often Discord is asked again whether the member is still in the server.
export const MEMBERSHIP_RECHECK_MS = 30 * 60 * 1000;
// How long a confirmed membership is trusted while Discord is unreachable.
export const MEMBERSHIP_GRACE_MS = 24 * 60 * 60 * 1000;
export const cookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
});
export const sessionCookieOptions = () => ({
  ...cookieOptions(),
  maxAge: SESSION_SECONDS,
});

async function recordMemberProfile(
  tx: SqlConnection,
  member: Member,
  previous?: Member,
): Promise<void> {
  const baseline = previous ?? member;
  // Existing accounts may predate status history. Preserve their old visible
  // profile before appending a change, so earlier cutoffs remain reconstructable.
  await tx.query(
    `INSERT INTO member_status_events (id,member_id,active,role,username,avatar_url,changed_at)
     SELECT $1,$2,$3,$4,$5,$6,$7 WHERE NOT EXISTS
       (SELECT 1 FROM member_status_events WHERE member_id=$2)
     ON CONFLICT (id) DO NOTHING`,
    [`initial:${baseline.id}`, baseline.id, baseline.active, baseline.role, baseline.username, baseline.avatarUrl, baseline.joinedAt],
  );
  if (previous && (previous.username !== member.username || previous.avatarUrl !== member.avatarUrl))
    await tx.query(
      `INSERT INTO member_status_events (id,member_id,active,role,username,avatar_url,changed_at)
       VALUES ($1,$2,$3,$4,$5,$6,clock_timestamp())`,
      [randomUUID(), member.id, member.active, member.role, member.username, member.avatarUrl],
    );
}

export async function registerDiscordMember(
  user: DiscordUser,
  db: Database | undefined = undefined,
  membership?: DiscordMembership,
): Promise<Member> {
  if (membership?.user && membership.user.id !== user.id) {
    throw new ApiError(401, "Your Discord identity could not be verified.", "DISCORD_AUTH_FAILED");
  }
  const profile = discordProfile(user, membership);
  db ??= await database();
  return db.transaction(async (tx) => {
    await lockAdministration(tx, db.dialect);
    const existing = await tx.query(
      "SELECT * FROM app_members WHERE discord_id = $1 FOR UPDATE",
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
        "UPDATE app_members SET username = $2, display_name = $3, avatar_url = $4, global_avatar_url = $5, global_display_name = $6 WHERE id = $1 RETURNING *",
        [existing[0].id, user.username, profile.displayName, profile.avatarUrl, profile.globalAvatarUrl, profile.globalDisplayName],
      );
      const member = memberFromRow(updated[0]);
      await recordMemberProfile(tx, member, memberFromRow(existing[0]));
      return member;
    }
    const administrators = await tx.query(
      "SELECT id FROM app_members WHERE role = 'ADMIN' AND active = TRUE LIMIT 1",
    );
    const designated = process.env.INITIAL_ADMIN_DISCORD_ID;
    const initialAdmin =
      !administrators.length && (designated ? designated === user.id : true);
    const rows = await tx.query(
      "INSERT INTO app_members (id,discord_id,username,display_name,avatar_url,global_avatar_url,global_display_name,role) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
      [
        randomUUID(),
        user.id,
        user.username,
        profile.displayName,
        profile.avatarUrl,
        profile.globalAvatarUrl,
        profile.globalDisplayName,
        initialAdmin ? "ADMIN" : "MEMBER",
      ],
    );
    const member = memberFromRow(rows[0]);
    await recordMemberProfile(tx, member);
    return member;
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
  // Fast path: most requests come from a session whose Discord membership was
  // checked recently. Answer those with one read instead of a locking
  // transaction, so a page's parallel API calls no longer queue behind each other.
  const recent = await db.query(
    `SELECT s.expires_at AS session_expires_at, s.membership_checked_at, m.*
     FROM auth_sessions s JOIN app_members m ON m.id = s.member_id
     WHERE s.token_hash = $1 AND s.expires_at > NOW() AND m.active = TRUE`,
    [tokenHash],
  );
  if (!recent.length) return null;
  const checkedAt = new Date(iso(recent[0].membership_checked_at)!).getTime();
  if (Date.now() - checkedAt < MEMBERSHIP_RECHECK_MS) {
    // Slide the 180-day window at most once a day rather than on every request.
    const expiresAt = new Date(iso(recent[0].session_expires_at)!).getTime();
    if (expiresAt < Date.now() + (SESSION_SECONDS - 24 * 60 * 60) * 1000)
      await db.query(
        "UPDATE auth_sessions SET expires_at = $2 WHERE token_hash = $1",
        [tokenHash, new Date(Date.now() + SESSION_SECONDS * 1000).toISOString()],
      );
    return memberFromRow(recent[0]);
  }
  const result = await db.transaction(
    async (tx): Promise<{ member: Member | null; error?: ApiError }> => {
      // Deactivation locks the member before deleting its sessions. Match that
      // order so an atomic profile refresh cannot deadlock with deactivation.
      const bindings = await tx.query(
        "SELECT member_id FROM auth_sessions WHERE token_hash = $1 AND expires_at > NOW()",
        [tokenHash],
      );
      if (!bindings.length) return { member: null };
      const activeMembers = await tx.query(
        "SELECT id FROM app_members WHERE id = $1 AND active = TRUE FOR UPDATE",
        [bindings[0].member_id],
      );
      if (!activeMembers.length) return { member: null };
      // Serialize refreshes so concurrent requests cannot rotate the same refresh token twice.
      const sessions = await tx.query(
        "SELECT s.*, m.* FROM auth_sessions s JOIN app_members m ON m.id = s.member_id WHERE s.token_hash = $1 AND s.expires_at > NOW() AND m.active = TRUE FOR UPDATE OF s",
        [tokenHash],
      );
      if (!sessions.length) return { member: null };
      const session = sessions[0];
      if (
        Date.now() - new Date(iso(session.membership_checked_at)!).getTime() <
        MEMBERSHIP_RECHECK_MS
      ) {
        await tx.query(
          "UPDATE auth_sessions SET expires_at = $2 WHERE token_hash = $1",
          [tokenHash, new Date(Date.now() + SESSION_SECONDS * 1000).toISOString()],
        );
        return { member: memberFromRow(session) };
      }
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
        const membership = await assertGuildMembership(accessToken, dependencies.fetcher);
        if (membership.user && membership.user.id !== String(session.discord_id)) {
          throw new ApiError(401, "Your Discord identity could not be verified.", "DISCORD_AUTH_FAILED");
        }
        const profileUser = membership.user ?? {
          id: String(session.discord_id),
          username: String(session.username),
          avatar: null,
          discriminator: "0",
        };
        const previousGlobalAvatar = session.global_avatar_url
          ? String(session.global_avatar_url)
          : session.avatar_url && !String(session.avatar_url).includes("/guilds/")
            ? String(session.avatar_url)
            : undefined;
        const profile = discordProfile(
          profileUser,
          membership,
          membership.user ? undefined : previousGlobalAvatar,
          membership.user ? undefined : session.global_display_name ? String(session.global_display_name) : null,
        );
        const previousMember = memberFromRow(session);
        const updatedMembers = await tx.query(
          "UPDATE app_members SET username = $2, display_name = $3, avatar_url = $4, global_avatar_url = $5, global_display_name = $6 WHERE id = $1 AND active = TRUE RETURNING *",
          [session.member_id, profileUser.username, profile.displayName, profile.avatarUrl, profile.globalAvatarUrl, profile.globalDisplayName],
        );
        if (!updatedMembers.length) return { member: null };
        await recordMemberProfile(tx, memberFromRow(updatedMembers[0]), previousMember);
        Object.assign(session, updatedMembers[0]);
        await tx.query(
          "UPDATE auth_sessions SET membership_checked_at = NOW(), expires_at = $2 WHERE token_hash = $1",
          [tokenHash, new Date(Date.now() + SESSION_SECONDS * 1000).toISOString()],
        );
      } catch (error) {
        // A brief Discord outage or rate limit should not sign members out or
        // block the page: trust a membership confirmed within the last day.
        if (error instanceof ApiError && error.status === 503) {
          const lastChecked = new Date(iso(session.membership_checked_at)!).getTime();
          if (Date.now() - lastChecked < MEMBERSHIP_GRACE_MS)
            return { member: memberFromRow(session) };
          return { member: null, error };
        }
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
