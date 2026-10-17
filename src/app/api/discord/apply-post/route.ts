import { requireMember } from "@/lib/server/auth";
import { assertSameOrigin } from "@/lib/server/config";
import { refreshApplyPost } from "@/lib/server/discord-applications";
import { ApiError, errorResponse, privateResponse } from "@/lib/server/errors";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Admins: update the Apply post in #📝-apply to the latest wording. */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await requireMember();
    if (actor.role !== "ADMIN") throw new ApiError(403, "Only administrators can update the Apply post.", "ADMIN_REQUIRED");
    return privateResponse(await refreshApplyPost());
  } catch (error) {
    return errorResponse(error);
  }
}
