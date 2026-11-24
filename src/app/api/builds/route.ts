import { after } from "next/server";
import { requireMember } from "@/lib/server/auth";
import { syncBuildsThread, loadBuildsPage, updateBuildsSettings } from "@/lib/server/builds-discord";
import { assertSameOrigin } from "@/lib/server/config";
import { errorResponse, privateResponse } from "@/lib/server/errors";
import { buildSettingsSchema } from "@/lib/server/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The current top builds, the archive and the leaders' links (and, for leaders, the Discord thread). */
export async function GET() {
  try { return privateResponse(await loadBuildsPage(await requireMember())); }
  catch (error) { return errorResponse(error); }
}

/** Leaders: switch the Discord builds thread on or off. Switching on brings it up to date straight after. */
export async function PUT(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await requireMember();
    const input = buildSettingsSchema.parse(await request.json());
    const page = await updateBuildsSettings(actor, input);
    if (input.discordEnabled) after(() => syncBuildsThread().then(() => undefined, () => undefined));
    return privateResponse(page);
  } catch (error) { return errorResponse(error); }
}
