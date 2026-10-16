import { requireMember } from "@/lib/server/auth";
import { assertSameOrigin } from "@/lib/server/config";
import { errorResponse, privateResponse } from "@/lib/server/errors";
import { readWarSchema } from "@/lib/server/validation";
import { readWarScreenshots } from "@/lib/server/war-results";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await requireMember();
    const input = readWarSchema.parse(await request.json());
    return privateResponse({ reading: await readWarScreenshots(actor, input.images) });
  } catch (error) { return errorResponse(error); }
}
