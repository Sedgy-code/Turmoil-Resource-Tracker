import { z } from "zod";
import { requireMember } from "@/lib/server/auth";
import { assertSameOrigin } from "@/lib/server/config";
import { errorResponse, privateResponse } from "@/lib/server/errors";
import { cancelSnipe } from "@/lib/server/planning";
import { tellSnipersCancelled } from "@/lib/server/snipe-discord";

export const runtime = "nodejs";

const cancelSchema = z.object({ tellSnipers: z.boolean() }).strict();

/**
 * Leaders: call off a snipe that isn't needed. If they ask, the bot tells everyone who said Yes in
 * #snipe-chat (told: true), or says it couldn't (told: false); told is null when nobody was told.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requireMember();
    const id = z.string().uuid().parse((await context.params).id);
    const input = cancelSchema.parse(await request.json());
    const { plan, leader, snipers } = await cancelSnipe(actor, id);
    const told = input.tellSnipers && snipers.length ? await tellSnipersCancelled(plan, leader.username, snipers) : null;
    return privateResponse({ plan, told });
  } catch (error) { return errorResponse(error); }
}
