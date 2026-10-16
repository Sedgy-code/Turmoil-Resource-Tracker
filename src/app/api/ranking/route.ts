import { requireMember } from "@/lib/server/auth";
import { errorResponse, privateResponse } from "@/lib/server/errors";
import { contributionRanking } from "@/lib/server/ranking";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try { return privateResponse(await contributionRanking(await requireMember())); }
  catch (error) { return errorResponse(error); }
}
