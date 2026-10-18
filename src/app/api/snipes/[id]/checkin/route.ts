import { z } from "zod";
import { requireMember } from "@/lib/server/auth";
import { assertSameOrigin } from "@/lib/server/config";
import { checkInToSnipe } from "@/lib/server/planning";
import { errorResponse, privateResponse } from "@/lib/server/errors";

export const runtime = "nodejs";

/** "I'm here": the member checks in to a snipe that's on now (+10 Clan Points, once a week). */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requireMember();
    const id = z.string().uuid().parse((await context.params).id);
    return privateResponse({ plan: await checkInToSnipe(actor, id) });
  } catch (error) { return errorResponse(error); }
}
