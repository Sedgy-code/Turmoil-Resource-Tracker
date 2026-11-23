import { requireMember } from "@/lib/server/auth";
import { assertSameOrigin } from "@/lib/server/config";
import { errorResponse, privateResponse } from "@/lib/server/errors";
import { getSpendingOrder, updateSpendingSettings } from "@/lib/server/spending-order";
import { spendSettingsSchema } from "@/lib/server/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The spending order: each line (Skills, Pets, Mounts) for today's clan day or the next one. */
export async function GET() {
  try {
    return privateResponse(await getSpendingOrder(await requireMember()));
  } catch (error) { return errorResponse(error); }
}

/** Leaders: turns at once for each line, and the Discord post switch. */
export async function PUT(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await requireMember();
    return privateResponse(await updateSpendingSettings(actor, spendSettingsSchema.parse(await request.json())));
  } catch (error) { return errorResponse(error); }
}
