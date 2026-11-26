import { applyAutoStrikes } from "@/lib/server/auto-strikes";
import { timingSafeMatch } from "@/lib/server/crypto";
import { ApiError, errorResponse, privateResponse } from "@/lib/server/errors";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Called by the Vercel cron in vercel.json (Wednesday 00:05 UTC, just after War Day 1 ends); Vercel sends the CRON_SECRET as a bearer token. */
export async function GET(request: Request) {
  try {
    const secret = process.env.CRON_SECRET;
    if (!secret || !timingSafeMatch(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
      throw new ApiError(401, "Scheduled automatic strikes are not authorized.", "UNAUTHORIZED_JOB");
    }
    return privateResponse(await applyAutoStrikes());
  } catch (error) { return errorResponse(error); }
}
