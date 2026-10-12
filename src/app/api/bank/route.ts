import { requireMember } from "@/lib/server/auth";
import { historicalBankDashboard, liveDashboard, saveBank } from "@/lib/server/banks";
import { assertSameOrigin } from "@/lib/server/config";
import { currentWeek } from "@/lib/resources";
import { saveBankSchema, weekSchema } from "@/lib/server/validation";
import { errorResponse, privateResponse } from "@/lib/server/errors";
import { z } from "zod";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor = await requireMember();
    const parameters = new URL(request.url).searchParams;
    const week = weekSchema.parse(parameters.get("week") ?? currentWeek());
    const snapshot = parameters.get("snapshot");
    if (snapshot) {
      return privateResponse(await historicalBankDashboard(actor, week, undefined, z.string().uuid().parse(snapshot)));
    }
    return privateResponse(week === currentWeek() ? await liveDashboard(actor) : await historicalBankDashboard(actor, week));
  } catch (error) { return errorResponse(error); }
}
export async function PUT(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await requireMember();
    return privateResponse({ entry: await saveBank(actor, saveBankSchema.parse(await request.json())) });
  } catch (error) { return errorResponse(error); }
}
