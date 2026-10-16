import { requireMember } from "@/lib/server/auth";
import { errorResponse, privateResponse } from "@/lib/server/errors";
import { recognition } from "@/lib/server/war-results";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try { return privateResponse(await recognition(await requireMember())); }
  catch (error) { return errorResponse(error); }
}
