import { z } from "zod";
import { requireMember } from "@/lib/server/auth";
import { assertSameOrigin } from "@/lib/server/config";
import { updateSnipe } from "@/lib/server/planning";
import { updateSnipeSchema } from "@/lib/server/validation";
import { errorResponse, privateResponse } from "@/lib/server/errors";
export const runtime = "nodejs";
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requireMember();
    const id = z.string().uuid().parse((await context.params).id);
    return privateResponse({ plan: await updateSnipe(actor, id, updateSnipeSchema.parse(await request.json())) });
  } catch (error) { return errorResponse(error); }
}
