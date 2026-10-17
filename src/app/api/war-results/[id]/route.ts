import { z } from "zod";
import { requireMember } from "@/lib/server/auth";
import { assertSameOrigin } from "@/lib/server/config";
import { errorResponse, privateResponse } from "@/lib/server/errors";
import { updateWarSchema } from "@/lib/server/validation";
import { deleteWarResult, updateWarResult } from "@/lib/server/war-results";

export const runtime = "nodejs";

/** Admins: fix a saved record (numbers, missing players, clan total, name). */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requireMember();
    const id = z.string().uuid().parse((await context.params).id);
    const input = updateWarSchema.parse(await request.json());
    return privateResponse({ result: await updateWarResult(actor, id, input) });
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requireMember();
    const id = z.string().uuid().parse((await context.params).id);
    await deleteWarResult(actor, id);
    return privateResponse({ deleted: true });
  } catch (error) { return errorResponse(error); }
}
