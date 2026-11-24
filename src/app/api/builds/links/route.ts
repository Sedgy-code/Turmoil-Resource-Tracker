import { requireMember } from "@/lib/server/auth";
import { addBuildLink, removeBuildLink } from "@/lib/server/builds";
import { loadBuildsPage } from "@/lib/server/builds-discord";
import { assertSameOrigin } from "@/lib/server/config";
import { errorResponse, privateResponse } from "@/lib/server/errors";
import { buildLinkRemoveSchema, buildLinkSchema } from "@/lib/server/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Leaders: add a link to another guide. */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await requireMember();
    await addBuildLink(actor, buildLinkSchema.parse(await request.json()));
    return privateResponse(await loadBuildsPage(actor));
  } catch (error) { return errorResponse(error); }
}

/** Leaders: remove a link. */
export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await requireMember();
    await removeBuildLink(actor, buildLinkRemoveSchema.parse(await request.json()).id);
    return privateResponse(await loadBuildsPage(actor));
  } catch (error) { return errorResponse(error); }
}
