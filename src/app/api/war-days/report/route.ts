import { requireMember } from "@/lib/server/auth";
import { errorResponse, privateResponse } from "@/lib/server/errors";
import { weekSchema } from "@/lib/server/validation";
import { warDayReport } from "@/lib/server/war-days";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Who scored on which day of a war (default: the current war), from the daily uploads. */
export async function GET(request: Request) {
  try {
    const week = new URL(request.url).searchParams.get("week");
    return privateResponse(await warDayReport(await requireMember(), week ? weekSchema.parse(week) : undefined));
  } catch (error) { return errorResponse(error); }
}
