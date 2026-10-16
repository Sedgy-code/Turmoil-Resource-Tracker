import { z } from "zod";
import { requireMember } from "@/lib/server/auth";
import { memberHistory } from "@/lib/server/leadership";
import { errorResponse, privateResponse } from "@/lib/server/errors";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireMember();
    const id = z.string().uuid().parse((await context.params).id);
    return privateResponse(await memberHistory(actor, id));
  } catch (error) {
    return errorResponse(error);
  }
}
