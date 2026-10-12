import type { NextRequest } from "next/server";
import { configurationIssues, isDemo } from "@/lib/server/config";
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
    const response = privateResponse({ user, demo, configured });
    // Route responses can refresh cookies; server component renders cannot.
    // Only return the existing opaque token after authentication succeeds.
    if (user && token && !demo)
      response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
