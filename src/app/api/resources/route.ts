import { requireMember } from "@/lib/server/auth";
import { assertSameOrigin } from "@/lib/server/config";
import { saveResourcesSchema } from "@/lib/server/validation";
import { saveEntry } from "@/lib/server/tracker";
import { saveBank } from "@/lib/server/banks";
import { currentWeek, LEGACY_EGGS_PETS_KEYS } from "@/lib/resources";
import { ApiError, errorResponse, privateResponse } from "@/lib/server/errors";
export const runtime = "nodejs";
export async function PUT(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await requireMember();
    const body = await request.json();
    const input = saveResourcesSchema.parse(body);
    if (input.week === currentWeek()) {
      const rawResources = body.resources as Record<string, unknown> | undefined;
      const hasTotals = ["skillTickets", "mountKeys", "mountsToMerge", "hammers"].every((key) => typeof rawResources?.[key] === "number");
      const hasEggs = typeof rawResources?.eggsPetsTotal === "number" || LEGACY_EGGS_PETS_KEYS.every((key) => typeof rawResources?.[key] === "number");
      if (!hasTotals || !hasEggs) throw new ApiError(400,
        "Complete every resource total before saving. Incomplete information cannot be saved and will not earn the weekly 20 Clan Points.", "BANK_INCOMPLETE");
    }
    const entry = input.week === currentWeek()
      ? await saveBank(actor, { memberId: input.memberId, resources: input.resources, summoningCosts: input.summoningCosts, notes: input.notes,
        preserveEggshells: body.resources?.eggshellsTotal === undefined })
      : await saveEntry(actor, input);
    return privateResponse({ entry });
  } catch (error) {
    return errorResponse(error);
  }
}
