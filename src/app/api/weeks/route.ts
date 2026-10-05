import { requireMember } from "@/lib/server/auth";
import { currentWeek } from "@/lib/resources";
import { listWeeks } from "@/lib/server/tracker";
import { errorResponse, privateResponse } from "@/lib/server/errors";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    await requireMember();
    return privateResponse({
      weeks: await listWeeks(),
      currentWeek: currentWeek(),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
