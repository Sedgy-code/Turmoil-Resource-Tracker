import { z } from "zod";
import { requireMember } from "@/lib/server/auth";
import { assertSameOrigin } from "@/lib/server/config";
import { errorResponse, privateResponse } from "@/lib/server/errors";
import { nudgeMember } from "@/lib/server/leader";

export const runtime = "nodejs";

const schema = z.object({ memberId: z.string().uuid() });

/** A leader's one-tap Discord reminder to a member who hasn't saved (once per member per week). */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await requireMember();
    const { memberId } = schema.parse(await request.json());
    return privateResponse({ nudge: await nudgeMember(actor, memberId) });
  } catch (error) {
    return errorResponse(error);
  }
}
