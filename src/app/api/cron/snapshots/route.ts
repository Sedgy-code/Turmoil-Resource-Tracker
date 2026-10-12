import { timingSafeMatch } from "@/lib/server/crypto";
import { captureWeeklySnapshots } from "@/lib/server/banks";
import { ApiError, errorResponse, privateResponse } from "@/lib/server/errors";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const secret = process.env.CRON_SECRET;
    if (!secret || !timingSafeMatch(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
      throw new ApiError(401, "Scheduled snapshot access is not authorized.", "UNAUTHORIZED_JOB");
    }
    return privateResponse({ captured: await captureWeeklySnapshots() });
  } catch (error) { return errorResponse(error); }
}
