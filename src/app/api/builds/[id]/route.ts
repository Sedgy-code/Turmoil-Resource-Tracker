import { z } from "zod";
import { requireMember } from "@/lib/server/auth";
import { loadBuildSnapshot } from "@/lib/server/builds";
import { errorResponse, privateResponse } from "@/lib/server/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** An older build set from the archive. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireMember();
    const id = z.coerce.number().int().positive().parse((await context.params).id);
    return privateResponse(await loadBuildSnapshot(actor, id));
  } catch (error) { return errorResponse(error); }
}
