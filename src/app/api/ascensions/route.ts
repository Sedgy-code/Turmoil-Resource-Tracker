import { requireMember } from "@/lib/server/auth";
import { getAscensions, setAscension } from "@/lib/server/ascensions";
import { assertSameOrigin } from "@/lib/server/config";
import { errorResponse, privateResponse } from "@/lib/server/errors";
import { ascensionSchema, weekSchema } from "@/lib/server/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Who is ascending this clan week (or ?week=), and your own answer. */
export async function GET(request: Request) {
  try {
    const week = new URL(request.url).searchParams.get("week");
    return privateResponse(await getAscensions(await requireMember(), week ? weekSchema.parse(week) : undefined));
  } catch (error) { return errorResponse(error); }
}

/** Your answer for this week: { pillars: [] } means you're not ascending. */
export async function PUT(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await requireMember();
    return privateResponse(await setAscension(actor, ascensionSchema.parse(await request.json()).pillars));
  } catch (error) { return errorResponse(error); }
}
