import { requireMember } from "@/lib/server/auth";
import { assertSameOrigin } from "@/lib/server/config";
import { updateMemberSchema } from "@/lib/server/validation";
import { updateMember } from "@/lib/server/tracker";
import { errorResponse, privateResponse } from "@/lib/server/errors";
import { z } from "zod";
export const runtime = "nodejs";
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(request);
    const actor = await requireMember();
    const id = z
      .string()
      .uuid()
      .parse((await context.params).id);
    const input = updateMemberSchema.parse(await request.json());
    return privateResponse({ member: await updateMember(actor, id, input) });
  } catch (error) {
    return errorResponse(error);
  }
}
