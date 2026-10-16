import type { NextRequest } from "next/server";
import { appUrl, configurationIssues, isDemo, isPreviewDeployment } from "@/lib/server/config";
import { authenticatedMember, SESSION_COOKIE, sessionCookieOptions } from "@/lib/server/auth";
import { errorResponse, privateResponse } from "@/lib/server/errors";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    const demo = isDemo();
    const configured = configurationIssues().length === 0;
    const token = request.cookies.get(SESSION_COOKIE)?.value;
    const user = configured ? await authenticatedMember(token) : null;
    // The browser moves itself to the public address, so sign-in cookies are
    // always saved for the same site members open from Discord.
    let canonicalOrigin: string | undefined;
    if (process.env.NODE_ENV === "production" && !isPreviewDeployment()) {
      try { canonicalOrigin = appUrl(); } catch { canonicalOrigin = undefined; }
    }
    const response = privateResponse({ user, demo, configured, canonicalOrigin });
    // Route responses can refresh cookies; server component renders cannot.
    // Only return the existing opaque token after authentication succeeds.
    if (user && token && !demo)
      response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
