import { after } from "next/server";
import { requireMember } from "@/lib/server/auth";
import { assertSameOrigin } from "@/lib/server/config";
import { afterEarlyChange, askEarlySpend, decideEarlySpend, earlySpendCheck, postEarlyNotice } from "@/lib/server/early-spend";
import { ApiError, errorResponse, privateResponse } from "@/lib/server/errors";
import { earlyAskSchema, earlyDecisionSchema } from "@/lib/server/validation";
import type { SpendResource } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Before the form opens: can this member ask to spend this line early, and is a reason needed? */
export async function GET(request: Request) {
  try {
    const actor = await requireMember();
    const url = new URL(request.url);
    const day = Number(url.searchParams.get("day"));
    const resource = url.searchParams.get("resource") as SpendResource;
    if (!Number.isInteger(day) || day < 1 || day > 5 || !["skills", "pets", "mounts"].includes(resource)) throw new ApiError(400, "Pick a line and a clan day.", "VALIDATION_ERROR");
    return privateResponse(await earlySpendCheck(actor, { day, resource }));
  } catch (error) { return errorResponse(error); }
}

/** A member asks to spend early; the request's message goes into that day's Discord post afterwards. */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await requireMember();
    const asked = await askEarlySpend(actor, earlyAskSchema.parse(await request.json()));
    after(() => postEarlyNotice(asked.id).then(() => undefined, () => undefined));
    return privateResponse(asked);
  } catch (error) { return errorResponse(error); }
}

/** Leaders approve or decline; the member who asked can cancel. Discord catches up afterwards. */
export async function PATCH(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await requireMember();
    const decided = await decideEarlySpend(actor, earlyDecisionSchema.parse(await request.json()));
    after(() => afterEarlyChange(decided.id).then(() => undefined, () => undefined));
    return privateResponse(decided);
  } catch (error) { return errorResponse(error); }
}
