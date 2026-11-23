import { timingSafeMatch } from "@/lib/server/crypto";
import { ApiError, errorResponse, privateResponse } from "@/lib/server/errors";
import { syncSpendingPosts } from "@/lib/server/spending-order";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Called by the Vercel cron in vercel.json just after each day starts; Vercel sends the CRON_SECRET as a bearer token. */
export async function GET(request: Request) {
  try {
    const secret = process.env.CRON_SECRET;
    if (!secret || !timingSafeMatch(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
      throw new ApiError(401, "Scheduled spending order post is not authorized.", "UNAUTHORIZED_JOB");
    }
    return privateResponse(await syncSpendingPosts());
  } catch (error) { return errorResponse(error); }
}
