import { requireMember } from "@/lib/server/auth";
import { assertSameOrigin } from "@/lib/server/config";
import { saveHoardingNote } from "@/lib/server/hoarding";
import { hoardingNoteSchema } from "@/lib/server/validation";
import { errorResponse, privateResponse } from "@/lib/server/errors";

export const runtime = "nodejs";

export async function PUT(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await requireMember();
    const input = hoardingNoteSchema.parse(await request.json());
    return privateResponse(await saveHoardingNote(actor, input));
  } catch (error) { return errorResponse(error); }
}
