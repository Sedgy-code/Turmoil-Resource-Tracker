import { timingSafeMatch } from "@/lib/server/crypto";
import { sendLeadershipReminder } from "@/lib/server/reminders";
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
    const which = new URL(request.url).searchParams.get("for");
    const kinds = which === "war" ? ["war" as const] : which === "vials" ? ["vials" as const] : undefined;
    return privateResponse(await sendLeadershipReminder({ kinds }));
  } catch (error) { return errorResponse(error); }
}
