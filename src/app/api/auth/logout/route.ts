import { cookies } from "next/headers";
import { assertSameOrigin } from "@/lib/server/config";
import {
  revokeSession,
  SESSION_COOKIE,
  OAUTH_COOKIE,
  cookieOptions,
} from "@/lib/server/auth";
import { errorResponse, privateResponse } from "@/lib/server/errors";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await revokeSession((await cookies()).get(SESSION_COOKIE)?.value);
    const response = privateResponse({ ok: true });
    response.cookies.set(SESSION_COOKIE, "", { ...cookieOptions(), maxAge: 0 });
    response.cookies.set(OAUTH_COOKIE, "", { ...cookieOptions(), maxAge: 0 });
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
