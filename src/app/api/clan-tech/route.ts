import { z } from "zod";
import { requireMember } from "@/lib/server/auth";
import { assertSameOrigin } from "@/lib/server/config";
import { loadClanTech, saveClanTech } from "@/lib/server/clan-tech";
import { errorResponse, privateResponse } from "@/lib/server/errors";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  try { return privateResponse(await loadClanTech(await requireMember())); }
  catch (error) { return errorResponse(error); }
}
export async function PUT(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await requireMember();
    const input = z.object({ levels: z.record(z.string().max(60), z.number().int().min(0).max(100)).optional(), reset: z.boolean().optional() }).parse(await request.json());
    return privateResponse(await saveClanTech(actor, input));
  } catch (error) { return errorResponse(error); }
}
