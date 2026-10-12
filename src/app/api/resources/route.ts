import { requireMember } from "@/lib/server/auth";
import { assertSameOrigin } from "@/lib/server/config";
import { saveResourcesSchema } from "@/lib/server/validation";
import { saveEntry } from "@/lib/server/tracker";
import { saveBank } from "@/lib/server/banks";
import { currentWeek } from "@/lib/resources";
import { errorResponse, privateResponse } from "@/lib/server/errors";
export const runtime = "nodejs";
export async function PUT(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await requireMember();
    const input = saveResourcesSchema.parse(await request.json());
    const entry = input.week === currentWeek()
      ? await saveBank(actor, { memberId: input.memberId, resources: input.resources, summoningCosts: input.summoningCosts, notes: input.notes })
      : await saveEntry(actor, input);
    return privateResponse({ entry });
  } catch (error) {
    return errorResponse(error);
  }
}
