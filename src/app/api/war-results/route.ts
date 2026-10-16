import { requireMember } from "@/lib/server/auth";
import { assertSameOrigin } from "@/lib/server/config";
import { errorResponse, privateResponse } from "@/lib/server/errors";
import { recordKindSchema, saveWarSchema } from "@/lib/server/validation";
import { listWarResults, saveWarResult } from "@/lib/server/war-results";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const kind = recordKindSchema.parse(new URL(request.url).searchParams.get("kind") ?? "war");
    return privateResponse(await listWarResults(await requireMember(), undefined, kind));
  }
  catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await requireMember();
    const input = saveWarSchema.parse(await request.json());
    return privateResponse({ result: await saveWarResult(actor, input) });
  } catch (error) { return errorResponse(error); }
}
