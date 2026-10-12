import { z } from "zod";
import { requireMember } from "@/lib/server/auth";
import { assertSameOrigin } from "@/lib/server/config";
import { confirmSnipeAttendance } from "@/lib/server/planning";
import { snipeAttendanceSchema } from "@/lib/server/validation";
import { errorResponse, privateResponse } from "@/lib/server/errors";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requireMember();
    const id = z.string().uuid().parse((await context.params).id);
    const input = snipeAttendanceSchema.parse(await request.json());
    return privateResponse({ plan: await confirmSnipeAttendance(actor, id, input) });
  } catch (error) { return errorResponse(error); }
}
