import { requireMember } from "@/lib/server/auth";
import { assertSameOrigin } from "@/lib/server/config";
import { saveResourcesSchema } from "@/lib/server/validation";
import { saveEntry } from "@/lib/server/tracker";
import { errorResponse, privateResponse } from "@/lib/server/errors";
export const runtime = "nodejs";
export async function PUT(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await requireMember();
    const input = saveResourcesSchema.parse(await request.json());
    return privateResponse({ entry: await saveEntry(actor, input) });
  } catch (error) {
    return errorResponse(error);
  }
}
