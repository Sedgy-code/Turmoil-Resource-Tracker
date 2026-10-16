import { z } from "zod";
import { requireMember } from "@/lib/server/auth";
import { assertSameOrigin } from "@/lib/server/config";
import { decideApplication } from "@/lib/server/applications";
import { errorResponse, privateResponse } from "@/lib/server/errors";
export const runtime = "nodejs";
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requireMember();
    const id = z.string().uuid().parse((await context.params).id);
    const { status } = z.object({ status: z.enum(["accepted", "declined"]) }).parse(await request.json());
    return privateResponse({ application: await decideApplication(actor, id, status) });
  } catch (error) {
    return errorResponse(error);
  }
}
