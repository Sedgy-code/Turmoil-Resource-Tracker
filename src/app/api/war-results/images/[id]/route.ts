import { z } from "zod";
import { requireMember } from "@/lib/server/auth";
import { errorResponse } from "@/lib/server/errors";
import { warScreenshot } from "@/lib/server/war-results";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireMember();
    const id = z.string().uuid().parse((await context.params).id);
    const image = await warScreenshot(actor, id);
    return new Response(Buffer.from(image.data, "base64"), {
      headers: { "Content-Type": image.mime, "Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff" },
    });
  } catch (error) { return errorResponse(error); }
}
