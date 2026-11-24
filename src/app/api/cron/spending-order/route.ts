import { timingSafeMatch } from "@/lib/server/crypto";
import { ApiError, errorResponse, privateResponse } from "@/lib/server/errors";
import { closeEarlyTickets } from "@/lib/server/early-spend";
import { syncSpendingPosts } from "@/lib/server/spending-order";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Called by the Vercel crons in vercel.json (just after each day starts, and at 12:05 UTC); Vercel sends the CRON_SECRET as a bearer token. */
export async function GET(request: Request) {
  try {
    const secret = process.env.CRON_SECRET;
    if (!secret || !timingSafeMatch(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
      throw new ApiError(401, "Scheduled spending order post is not authorized.", "UNAUTHORIZED_JOB");
    }
    const posts = await syncSpendingPosts();
    // Early spend tickets close when their clan day ends (on their own, so a Discord hiccup never stops the posts).
    const ticketsClosed = await closeEarlyTickets().catch((error) => { console.warn("Early spend tickets not closed:", error); return 0; });
    return privateResponse({ ...posts, ticketsClosed });
  } catch (error) { return errorResponse(error); }
}
