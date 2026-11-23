import { requireMember } from "@/lib/server/auth";
import { assertSameOrigin } from "@/lib/server/config";
import { errorResponse, privateResponse } from "@/lib/server/errors";
import { postSpendingNow, spendingPostPreview, updateSpendingPostsNow } from "@/lib/server/spending-order";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Leaders: the #spending-order post as it would look right now. */
export async function GET() {
  try {
    return privateResponse(await spendingPostPreview(await requireMember()));
  } catch (error) { return errorResponse(error); }
}

/** Leaders: open the post that's due (tomorrow's, or today's) now instead of waiting for the job. */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    return privateResponse(await postSpendingNow(await requireMember()));
  } catch (error) { return errorResponse(error); }
}

/** Leaders: rewrite the posts that are up with the order as it stands now. */
export async function PATCH(request: Request) {
  try {
    assertSameOrigin(request);
    return privateResponse(await updateSpendingPostsNow(await requireMember()));
  } catch (error) { return errorResponse(error); }
}
