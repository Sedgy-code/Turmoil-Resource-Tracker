import { requireMember } from "@/lib/server/auth";
import { refreshBuilds } from "@/lib/server/builds-discord";
import { assertSameOrigin } from "@/lib/server/config";
import { errorResponse, privateResponse } from "@/lib/server/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Reading the builds file from 1vcian's site can take a few seconds.
export const maxDuration = 60;

/** Leaders: check 1vcian's site for new builds now, instead of waiting for the daily check. */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    return privateResponse(await refreshBuilds(await requireMember()));
  } catch (error) { return errorResponse(error); }
}
