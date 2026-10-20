import { requireMember } from "@/lib/server/auth";
import { assertSameOrigin } from "@/lib/server/config";
import { errorResponse, privateResponse } from "@/lib/server/errors";
import { remindNotSaved } from "@/lib/server/leader";

export const runtime = "nodejs";

/** A leader reminds everyone who hasn't saved this week: one Discord post mentioning them (every 12 hours at most). */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await requireMember();
    return privateResponse({ reminder: await remindNotSaved(actor) });
  } catch (error) {
    return errorResponse(error);
  }
}
