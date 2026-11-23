import { requireMember } from "@/lib/server/auth";
import { assertSameOrigin } from "@/lib/server/config";
import { errorResponse, privateResponse } from "@/lib/server/errors";
import { setSpendingDone } from "@/lib/server/spending-order";
import { spendDoneSchema } from "@/lib/server/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** "I'm done" or Undo on a line; leaders can send a memberId to do it for someone else. */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await requireMember();
    return privateResponse(await setSpendingDone(actor, spendDoneSchema.parse(await request.json())));
  } catch (error) { return errorResponse(error); }
}
