import { requireMember } from "@/lib/server/auth";
import { assertSameOrigin } from "@/lib/server/config";
import { errorResponse, privateResponse } from "@/lib/server/errors";
import { clanDaysSchema, weekSchema } from "@/lib/server/validation";
import { getClanDays, setClanDays } from "@/lib/server/war-days";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The clan days for a war (default: the current war). Every member can see them. */
export async function GET(request: Request) {
  try {
    const week = new URL(request.url).searchParams.get("week");
    return privateResponse(await getClanDays(await requireMember(), week ? weekSchema.parse(week) : undefined));
  } catch (error) { return errorResponse(error); }
}

/** Admins: pick which war days (1–5) the clan spends on. */
export async function PUT(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await requireMember();
    return privateResponse(await setClanDays(actor, clanDaysSchema.parse(await request.json())));
  } catch (error) { return errorResponse(error); }
}
