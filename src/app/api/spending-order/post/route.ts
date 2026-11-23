import { requireMember } from "@/lib/server/auth";
import { assertSameOrigin } from "@/lib/server/config";
import { errorResponse, privateResponse } from "@/lib/server/errors";
import { postSpendingNow, spendingPostPreview } from "@/lib/server/spending-order";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Leaders: the #spending-order post as it would look right now. */
export async function GET() {
  try {
    return privateResponse(await spendingPostPreview(await requireMember()));
  } catch (error) { return errorResponse(error); }
}

/** Leaders: open today's post now instead of waiting for the next day's start. */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    return privateResponse(await postSpendingNow(await requireMember()));
  } catch (error) { return errorResponse(error); }
}
