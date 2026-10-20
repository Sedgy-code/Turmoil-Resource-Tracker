import { after } from "next/server";
import { z } from "zod";
import { requireMember } from "@/lib/server/auth";
import { assertSameOrigin } from "@/lib/server/config";
import { respondToSnipe } from "@/lib/server/planning";
import { giveSnipeRole } from "@/lib/server/snipe-discord";
import { snipeResponseSchema } from "@/lib/server/validation";
import { errorResponse, privateResponse } from "@/lib/server/errors";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requireMember();
    const id = z.string().uuid().parse((await context.params).id);
    const input = snipeResponseSchema.parse(await request.json());
    const plan = await respondToSnipe(actor, id, input);
    // A Yes opens #snipe-chat: the bot gives them the Snipe Group role once the answer is saved.
    if (input.answer === "yes") after(() => giveSnipeRole([actor.discordId]).then(() => undefined, () => undefined));
    return privateResponse({ plan });
  } catch (error) { return errorResponse(error); }
}
