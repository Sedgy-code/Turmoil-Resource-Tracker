import { configurationIssues, isDemo } from "@/lib/server/config";
import { currentMember } from "@/lib/server/auth";
import { errorResponse, privateResponse } from "@/lib/server/errors";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const demo = isDemo();
    const configured = configurationIssues().length === 0;
    const user = configured ? await currentMember() : null;
    return privateResponse({ user, demo, configured });
  } catch (error) {
    return errorResponse(error);
  }
}
