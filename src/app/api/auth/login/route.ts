import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { appUrl, isDemo, requireConfiguration } from "@/lib/server/config";
import { encrypt, randomToken } from "@/lib/server/crypto";
import { OAUTH_COOKIE, cookieOptions } from "@/lib/server/auth";
import { errorResponse } from "@/lib/server/errors";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    if (isDemo()) return NextResponse.redirect(`${appUrl()}/`);
    requireConfiguration();
    const state = randomToken();
    const verifier = randomToken();
    const url = new URL("https://discord.com/oauth2/authorize");
    url.search = new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID!,
      redirect_uri: `${appUrl()}/api/auth/callback`,
      response_type: "code",
      scope: "identify guilds.members.read",
      state,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
    }).toString();
    const response = NextResponse.redirect(url);
    response.cookies.set(
      OAUTH_COOKIE,
      encrypt(JSON.stringify({ state, verifier, issuedAt: Date.now() })),
      { ...cookieOptions(), maxAge: 600 },
    );
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
