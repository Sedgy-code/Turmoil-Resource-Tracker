import { requireMember } from "@/lib/server/auth";
import { errorResponse, privateResponse } from "@/lib/server/errors";
import { warSpending } from "@/lib/server/hoarding";
import { weekSchema } from "@/lib/server/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor = await requireMember();
    const week = weekSchema.parse(new URL(request.url).searchParams.get("week"));
    return privateResponse(await warSpending(actor, week));
  } catch (error) { return errorResponse(error); }
}
