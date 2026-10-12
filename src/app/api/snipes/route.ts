import { requireMember } from "@/lib/server/auth";
import { assertSameOrigin } from "@/lib/server/config";
import { createSnipe, listSnipes } from "@/lib/server/planning";
import { createSnipeSchema } from "@/lib/server/validation";
import { errorResponse, privateResponse } from "@/lib/server/errors";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  try { return privateResponse(await listSnipes(await requireMember())); }
  catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await requireMember();
    return privateResponse({ plan: await createSnipe(actor, createSnipeSchema.parse(await request.json())) });
  } catch (error) { return errorResponse(error); }
}
