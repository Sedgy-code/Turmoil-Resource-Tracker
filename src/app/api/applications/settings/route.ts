import { z } from "zod";
import { requireMember } from "@/lib/server/auth";
import { assertSameOrigin } from "@/lib/server/config";
import { saveApplicationSettings } from "@/lib/server/applications";
import { errorResponse, privateResponse } from "@/lib/server/errors";
export const runtime = "nodejs";
export async function PATCH(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await requireMember();
    const input = z.object({ open: z.boolean().optional(), channelId: z.string().trim().optional() }).parse(await request.json());
    return privateResponse({ settings: await saveApplicationSettings(actor, input) });
  } catch (error) {
    return errorResponse(error);
  }
}
