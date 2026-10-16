import { timingSafeMatch } from "@/lib/server/crypto";
import { syncDiscordMembers } from "@/lib/server/discord-sync";
import { registerCommands } from "@/lib/server/discord-interactions";
import { ApiError, errorResponse, privateResponse } from "@/lib/server/errors";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Daily: switch off members who left the Discord server, and back on if they return. */
export async function GET(request: Request) {
  try {
    const secret = process.env.CRON_SECRET;
    if (!secret || !timingSafeMatch(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
      throw new ApiError(401, "Scheduled member check is not authorized.", "UNAUTHORIZED_JOB");
    }
    // Also keeps the /checkin and /snipe-start commands installed.
    const commands = await registerCommands().catch(() => false);
    return privateResponse({ ...(await syncDiscordMembers()), commands });
  } catch (error) { return errorResponse(error); }
}
