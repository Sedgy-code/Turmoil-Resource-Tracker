import { timingSafeMatch } from "@/lib/server/crypto";
import { captureWeeklySnapshots } from "@/lib/server/banks";
import { sendSnipeShoutout } from "@/lib/server/reminders";
import { ApiError, errorResponse, privateResponse } from "@/lib/server/errors";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const secret = process.env.CRON_SECRET;
    if (!secret || !timingSafeMatch(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
      throw new ApiError(401, "Scheduled snapshot access is not authorized.", "UNAUTHORIZED_JOB");
    }
    const captured = await captureWeeklySnapshots();
    // Monday is also when last week's snipers are thanked in Discord; a Discord hiccup must not undo the snapshot.
    const shoutout = await sendSnipeShoutout().catch(() => ({ posted: false, members: 0 }));
    return privateResponse({ captured, shoutout });
  } catch (error) { return errorResponse(error); }
}
