import { requireMember } from "@/lib/server/auth";
import { assertSameOrigin } from "@/lib/server/config";
import { copyResourcesSchema } from "@/lib/server/validation";
import { copyPreviousEntry } from "@/lib/server/tracker";
import { historicalBankDashboard, saveBank } from "@/lib/server/banks";
import { currentWeek, shiftWeek } from "@/lib/resources";
import { ApiError } from "@/lib/server/errors";
import { errorResponse, privateResponse } from "@/lib/server/errors";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await requireMember();
    const input = copyResourcesSchema.parse(await request.json());
    if (input.week === currentWeek()) {
      const previous = await historicalBankDashboard(actor, shiftWeek(input.week, -1));
      const source = previous.entries.find(entry => entry.memberId === (input.memberId ?? actor.id));
      if (!source) throw new ApiError(404, "No resources were saved for the previous week.", "PREVIOUS_WEEK_EMPTY");
      return privateResponse({ entry: await saveBank(actor, {
        memberId: input.memberId, resources: source.resources,
        summoningCosts: source.summoningCosts, notes: source.notes,
      }) });
    }
    return privateResponse({ entry: await copyPreviousEntry(actor, input) });
  } catch (error) {
    return errorResponse(error);
  }
}
