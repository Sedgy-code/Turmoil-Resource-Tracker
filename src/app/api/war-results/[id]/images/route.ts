import { z } from "zod";
import { requireMember } from "@/lib/server/auth";
import { assertSameOrigin } from "@/lib/server/config";
import { errorResponse, privateResponse } from "@/lib/server/errors";
import { addScreenshotsSchema } from "@/lib/server/validation";
import { addWarResultImages } from "@/lib/server/war-results";

export const runtime = "nodejs";

/** Admins: add screenshots to a saved record, one or a few at a time. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requireMember();
    const id = z.string().uuid().parse((await context.params).id);
    const input = addScreenshotsSchema.parse(await request.json());
    return privateResponse(await addWarResultImages(actor, id, input.images));
  } catch (error) { return errorResponse(error); }
}
