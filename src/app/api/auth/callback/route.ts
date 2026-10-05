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
  SESSION_SECONDS,
  cookieOptions,
} from "@/lib/server/auth";
import { ApiError, errorResponse } from "@/lib/server/errors";
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
    if (parameters.has("error"))
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
    await assertGuildMembership(tokens.access_token);
    const member = await registerDiscordMember(user);
    const session = await createSession(member, tokens);
    const response = NextResponse.redirect(`${appUrl()}/`);
    response.cookies.set(SESSION_COOKIE, session, {
      ...cookieOptions(),
      maxAge: SESSION_SECONDS,
    });
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
