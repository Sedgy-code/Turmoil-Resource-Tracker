import { z } from "zod";
import { requireMember } from "@/lib/server/auth";
import { assertSameOrigin } from "@/lib/server/config";
import { applyLeadershipAction } from "@/lib/server/leadership";
import { errorResponse, privateResponse } from "@/lib/server/errors";
export const runtime = "nodejs";
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("strike"), reason: z.string().trim().min(1).max(300) }),
  z.object({ action: z.literal("remove-strike"), strikeId: z.string().uuid() }),
  z.object({ action: z.literal("holiday"), until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), reason: z.string().trim().max(200).optional() }),
]);
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requireMember();
    const id = z.string().uuid().parse((await context.params).id);
    return privateResponse({ member: await applyLeadershipAction(actor, id, schema.parse(await request.json())) });
  } catch (error) {
    return errorResponse(error);
  }
}
