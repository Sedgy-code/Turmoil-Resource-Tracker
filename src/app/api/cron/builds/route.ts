import { syncBuilds } from "@/lib/server/builds";
import { syncBuildsThread } from "@/lib/server/builds-discord";
import { timingSafeMatch } from "@/lib/server/crypto";
import { ApiError, errorResponse, privateResponse } from "@/lib/server/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Daily: pull the newest builds from 1vcian's site, then bring the Discord builds thread up to date. */
export async function GET(request: Request) {
  try {
    const secret = process.env.CRON_SECRET;
    if (!secret || !timingSafeMatch(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
      throw new ApiError(401, "Scheduled builds check is not authorized.", "UNAUTHORIZED_JOB");
    }
    const builds = await syncBuilds();
    const thread = await syncBuildsThread().catch((error: unknown) => ({ error: error instanceof Error ? error.message : "failed" }));
    return privateResponse({ builds, thread });
  } catch (error) { return errorResponse(error); }
}
