import { z } from "zod";
import { requireMember } from "@/lib/server/auth";
import { assertSameOrigin } from "@/lib/server/config";
import { errorResponse, privateResponse } from "@/lib/server/errors";
import { assembleSnipers } from "@/lib/server/snipe-discord";

export const runtime = "nodejs";
/** Handing out the Snipe Group role can take a few seconds when many members said Yes. */
export const maxDuration = 60;

/** Leaders: call everyone who said Yes to this snipe in #snipe-chat on Discord. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requireMember();
    const id = z.string().uuid().parse((await context.params).id);
    return privateResponse({ call: await assembleSnipers(actor, id) });
  } catch (error) { return errorResponse(error); }
}
