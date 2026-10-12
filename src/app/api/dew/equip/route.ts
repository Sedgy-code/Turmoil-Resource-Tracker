import { requireMember } from "@/lib/server/auth";
import { assertSameOrigin } from "@/lib/server/config";
import { equipDewItem } from "@/lib/server/planning";
import { equipDewSchema } from "@/lib/server/validation";
import { errorResponse, privateResponse } from "@/lib/server/errors";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await requireMember();
    const input = equipDewSchema.parse(await request.json());
    return privateResponse(await equipDewItem(actor, input.itemId, undefined, input.category));
  } catch (error) { return errorResponse(error); }
}
