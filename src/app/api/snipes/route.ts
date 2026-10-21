import { after } from "next/server";
import { requireMember } from "@/lib/server/auth";
import { assertSameOrigin } from "@/lib/server/config";
import { createSnipe, listSnipes } from "@/lib/server/planning";
import { catchUpSnipeRoles } from "@/lib/server/snipe-discord";
import { createSnipeSchema } from "@/lib/server/validation";
import { errorResponse, privateResponse } from "@/lib/server/errors";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const actor = await requireMember();
    const result = await listSnipes(actor);
    // A leader opening Snipes also makes sure everyone who said Yes can see #snipe-chat.
    if (actor.role === "ADMIN") after(() => catchUpSnipeRoles().then(() => undefined));
    return privateResponse(result);
  } catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await requireMember();
    return privateResponse({ plan: await createSnipe(actor, createSnipeSchema.parse(await request.json())) });
  } catch (error) { return errorResponse(error); }
}
