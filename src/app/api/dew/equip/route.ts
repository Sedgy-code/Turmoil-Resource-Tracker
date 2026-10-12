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
    return privateResponse(await equipDewItem(actor, equipDewSchema.parse(await request.json()).itemId));
  } catch (error) { return errorResponse(error); }
}
