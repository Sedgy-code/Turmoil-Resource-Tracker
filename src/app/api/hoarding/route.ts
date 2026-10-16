import { requireMember } from "@/lib/server/auth";
import { hoardingReport } from "@/lib/server/hoarding";
import { errorResponse, privateResponse } from "@/lib/server/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return privateResponse(await hoardingReport(await requireMember()));
  } catch (error) { return errorResponse(error); }
}
