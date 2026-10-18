import { requireMember } from "@/lib/server/auth";
import { assertSameOrigin } from "@/lib/server/config";
import { errorResponse, privateResponse } from "@/lib/server/errors";
import { clanDayVoteSchema } from "@/lib/server/validation";
import { getVotes, setVote } from "@/lib/server/war-votes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Members' votes for the next war's clan days. Everyone can see them. */
export async function GET() {
  try {
    return privateResponse(await getVotes(await requireMember()));
  } catch (error) { return errorResponse(error); }
}

/** Your vote: the days (1–5) you'd like the clan to spend on next war. */
export async function PUT(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await requireMember();
    return privateResponse(await setVote(actor, clanDayVoteSchema.parse(await request.json()).days));
  } catch (error) { return errorResponse(error); }
}
