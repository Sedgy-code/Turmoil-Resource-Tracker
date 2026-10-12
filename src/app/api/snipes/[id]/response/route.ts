import { z } from "zod";
import { requireMember } from "@/lib/server/auth";
import { assertSameOrigin } from "@/lib/server/config";
import { respondToSnipe } from "@/lib/server/planning";
import { snipeResponseSchema } from "@/lib/server/validation";
import { errorResponse, privateResponse } from "@/lib/server/errors";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requireMember();
    const id = z.string().uuid().parse((await context.params).id);
    return privateResponse({ plan: await respondToSnipe(actor, id, snipeResponseSchema.parse(await request.json())) });
  } catch (error) { return errorResponse(error); }
}
