import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { appUrl, requireConfiguration } from "@/lib/server/config";
import { decrypt, timingSafeMatch } from "@/lib/server/crypto";
import {
  assertGuildMembership,
  exchangeCode,
  fetchDiscordUser,
} from "@/lib/server/discord";
import {
  createSession,
  registerDiscordMember,
  SESSION_COOKIE,
  OAUTH_COOKIE,
  sessionCookieOptions,
  cookieOptions,
} from "@/lib/server/auth";
import { ApiError, errorResponse } from "@/lib/server/errors";
import { safeReturnPath } from "@/lib/return-path";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  let errorCode = "sign-in-failed";
  try {
    requireConfiguration();
    const parameters = new URL(request.url).searchParams;
    const state = parameters.get("state");
    const code = parameters.get("code");
    const encryptedState = (await cookies()).get(OAUTH_COOKIE)?.value;
    const discordError = parameters.get("error");
    // prompt=none can come back asking for approval: show Discord's screen once.
    if (discordError && ["consent_required", "interaction_required", "login_required"].includes(discordError)) {
      // Keep the page the member was heading to.
      let next = "/";
      try { if (encryptedState) next = safeReturnPath((JSON.parse(decrypt(encryptedState)) as { next?: unknown }).next); } catch { /* start from Home */ }
      const retry = NextResponse.redirect(`${appUrl()}/api/auth/login?consent=1${next === "/" ? "" : `&next=${encodeURIComponent(next)}`}`);
      retry.headers.set("Cache-Control", "no-store");
      return retry;
    }
    if (discordError)
      throw new ApiError(
        401,
        "Discord authorization was cancelled.",
        "AUTH_CANCELLED",
      );
    if (
      !encryptedState ||
      !state ||
      !code ||
      state.length > 128 ||
      code.length > 2048
    )
      throw new ApiError(401, "The sign-in request expired.", "INVALID_STATE");
    const pending = JSON.parse(decrypt(encryptedState)) as {
      state: string;
      verifier: string;
      issuedAt: number;
      next?: unknown;
    };
    if (
      typeof pending.state !== "string" ||
      typeof pending.verifier !== "string" ||
      !Number.isFinite(pending.issuedAt) ||
      !timingSafeMatch(pending.state, state) ||
      Date.now() - pending.issuedAt > 600000 ||
      pending.issuedAt > Date.now()
    )
      throw new ApiError(401, "The sign-in request expired.", "INVALID_STATE");
    const tokens = await exchangeCode(code, pending.verifier);
    const user = await fetchDiscordUser(tokens.access_token);
    const membership = await assertGuildMembership(tokens.access_token);
    const member = await registerDiscordMember(user, undefined, membership);
    const session = await createSession(member, tokens);
    const response = NextResponse.redirect(`${appUrl()}${safeReturnPath(pending.next)}`);
    response.cookies.set(SESSION_COOKIE, session, sessionCookieOptions());
    response.cookies.set(OAUTH_COOKIE, "", { ...cookieOptions(), maxAge: 0 });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    if (error instanceof ApiError)
      errorCode = error.code.toLowerCase().replaceAll("_", "-");
    let origin: string;
    try {
      origin = appUrl();
    } catch {
      return errorResponse(error);
    }
    const response = NextResponse.redirect(
      `${origin}/?error=${encodeURIComponent(errorCode)}`,
    );
    response.cookies.set(OAUTH_COOKIE, "", { ...cookieOptions(), maxAge: 0 });
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
}
