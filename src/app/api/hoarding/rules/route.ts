import { requireMember } from "@/lib/server/auth";
import { assertSameOrigin } from "@/lib/server/config";
import { errorResponse, privateResponse } from "@/lib/server/errors";
import { saveHoardingRules } from "@/lib/server/hoarding";
import { hoardingRulesSchema } from "@/lib/server/validation";

export const runtime = "nodejs";

export async function PUT(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await requireMember();
    return privateResponse({ rules: await saveHoardingRules(actor, hoardingRulesSchema.parse(await request.json())) });
  } catch (error) { return errorResponse(error); }
}
