import { requireMember } from "@/lib/server/auth";
import { assertSameOrigin } from "@/lib/server/config";
import { copyResourcesSchema } from "@/lib/server/validation";
import { copyPreviousEntry } from "@/lib/server/tracker";
import { errorResponse, privateResponse } from "@/lib/server/errors";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await requireMember();
    const input = copyResourcesSchema.parse(await request.json());
    return privateResponse({ entry: await copyPreviousEntry(actor, input) });
  } catch (error) {
    return errorResponse(error);
  }
}
