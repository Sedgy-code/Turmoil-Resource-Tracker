import { z } from "zod";
import { requireMember } from "@/lib/server/auth";
import { assertSameOrigin } from "@/lib/server/config";
import { errorResponse, privateResponse } from "@/lib/server/errors";
import { updateMySettings } from "@/lib/server/me";

export const runtime = "nodejs";

const schema = z.object({
  awayUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  remindersAllowed: z.boolean().optional(),
}).strict();

/** The member's own settings: time away and Discord reminders. */
export async function PATCH(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await requireMember();
    return privateResponse({ member: await updateMySettings(actor, schema.parse(await request.json())) });
  } catch (error) {
    return errorResponse(error);
  }
}
