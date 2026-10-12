import { requireMember } from "@/lib/server/auth";
import { bankHistory, captureSnapshot } from "@/lib/server/banks";
import { assertSameOrigin } from "@/lib/server/config";
import { errorResponse, privateResponse } from "@/lib/server/errors";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  try { return privateResponse(await bankHistory(await requireMember())); }
  catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    return privateResponse({ snapshot: await captureSnapshot(await requireMember()) });
  } catch (error) { return errorResponse(error); }
}
