import { z } from "zod";
import { requireMember } from "@/lib/server/auth";
import { assertSameOrigin } from "@/lib/server/config";
import { errorResponse, privateResponse } from "@/lib/server/errors";
import { deleteWarResult } from "@/lib/server/war-results";

export const runtime = "nodejs";

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requireMember();
    const id = z.string().uuid().parse((await context.params).id);
    await deleteWarResult(actor, id);
    return privateResponse({ deleted: true });
  } catch (error) { return errorResponse(error); }
}
