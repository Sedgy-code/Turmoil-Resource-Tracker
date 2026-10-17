import { requireMember } from "@/lib/server/auth";
import { assertSameOrigin } from "@/lib/server/config";
import { brandBot } from "@/lib/server/discord-branding";
import { ApiError, errorResponse, privateResponse } from "@/lib/server/errors";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Admins: give the site's bot the Turmoil name and crest, matching the clan's other bot. */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await requireMember();
    if (actor.role !== "ADMIN") throw new ApiError(403, "Only administrators can change how the bot looks.", "ADMIN_REQUIRED");
    return privateResponse(await brandBot());
  } catch (error) {
    return errorResponse(error);
  }
}
