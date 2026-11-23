import { after } from "next/server";
import { z } from "zod";
import { requireMember } from "@/lib/server/auth";
import { assertSameOrigin } from "@/lib/server/config";
import { updateSnipe } from "@/lib/server/planning";
import { refreshSnipePost } from "@/lib/server/snipe-discord";
import { updateSnipeSchema } from "@/lib/server/validation";
import { errorResponse, privateResponse } from "@/lib/server/errors";
export const runtime = "nodejs";
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requireMember();
    const id = z.string().uuid().parse((await context.params).id);
    const plan = await updateSnipe(actor, id, updateSnipeSchema.parse(await request.json()));
    // Its post in #snipe-chat follows the change (a new time, or reopened after a cancel). Edits never ping.
    after(() => refreshSnipePost(id).then(() => undefined));
    return privateResponse({ plan });
  } catch (error) { return errorResponse(error); }
}
