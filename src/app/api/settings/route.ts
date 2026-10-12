import { requireMember } from "@/lib/server/auth";
import { assertSameOrigin } from "@/lib/server/config";
import { getSettings, updateSettings } from "@/lib/server/settings";
import { settingsSchema } from "@/lib/server/validation";
import { errorResponse, privateResponse } from "@/lib/server/errors";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  try { return privateResponse({ settings: await getSettings(await requireMember()) }); }
  catch (error) { return errorResponse(error); }
}
export async function PATCH(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await requireMember();
    return privateResponse({ settings: await updateSettings(actor, settingsSchema.parse(await request.json())) });
  } catch (error) { return errorResponse(error); }
}
