import { timingSafeMatch } from "@/lib/server/crypto";
import { LEADERSHIP_TASKS, sendLeadershipReminder } from "@/lib/server/reminders";
import { ApiError, errorResponse, privateResponse } from "@/lib/server/errors";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Called by the Vercel cron in vercel.json; Vercel sends the CRON_SECRET as a bearer token. */
export async function GET(request: Request) {
  try {
    const secret = process.env.CRON_SECRET;
    if (!secret || !timingSafeMatch(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
      throw new ApiError(401, "Scheduled leadership reminder is not authorized.", "UNAUTHORIZED_JOB");
    }
    // ?for= lists the jobs to check, e.g. "warday" or "war,clanDays" (see vercel.json).
    const requested = (new URL(request.url).searchParams.get("for") ?? "").split(",");
    const tasks = LEADERSHIP_TASKS.filter((task) => requested.includes(task));
    return privateResponse(await sendLeadershipReminder({ tasks: tasks.length ? tasks : undefined }));
  } catch (error) { return errorResponse(error); }
}
