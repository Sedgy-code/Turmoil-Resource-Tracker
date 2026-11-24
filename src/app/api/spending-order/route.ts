import { after } from "next/server";
import { requireMember } from "@/lib/server/auth";
import { assertSameOrigin } from "@/lib/server/config";
import { errorResponse, privateResponse } from "@/lib/server/errors";
import { getSpendingOrder, updateSpendingPostsNow, updateSpendingSettings } from "@/lib/server/spending-order";
import { spendSettingsSchema } from "@/lib/server/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The spending order: each line (Skills, Pets, Mounts) for today's clan day or the next one. */
export async function GET() {
  try {
    return privateResponse(await getSpendingOrder(await requireMember()));
  } catch (error) { return errorResponse(error); }
}

/** Leaders: the daily Discord post switch. */
export async function PUT(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await requireMember();
    const input = spendSettingsSchema.parse(await request.json());
    const result = await updateSpendingSettings(actor, input);
    // Early spend requests switched on or off: the posts that are up get (or lose) the Ask button now.
    if (input.earlyDiscord !== undefined) after(() => updateSpendingPostsNow(actor).then(() => undefined, () => undefined));
    return privateResponse(result);
  } catch (error) { return errorResponse(error); }
}
