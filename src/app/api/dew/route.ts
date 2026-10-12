import { requireMember } from "@/lib/server/auth";
import { getDew } from "@/lib/server/planning";
import { errorResponse, privateResponse } from "@/lib/server/errors";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  try { return privateResponse(await getDew(await requireMember())); }
  catch (error) { return errorResponse(error); }
}
