import { requireMember } from "@/lib/server/auth";
import { assertSameOrigin } from "@/lib/server/config";
import { registerCommands } from "@/lib/server/discord-interactions";
import { ApiError, errorResponse, privateResponse } from "@/lib/server/errors";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Admins: update the bot's slash commands in the clan server now, instead of waiting for the nightly sync. */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await requireMember();
    if (actor.role !== "ADMIN") throw new ApiError(403, "Only administrators can update the bot’s commands.", "ADMIN_REQUIRED");
    return privateResponse({ registered: await registerCommands() });
  } catch (error) {
    return errorResponse(error);
  }
}
