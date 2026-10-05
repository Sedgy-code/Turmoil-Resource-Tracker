import { requireMember } from "@/lib/server/auth";
import { currentWeek } from "@/lib/resources";
import { dashboard } from "@/lib/server/tracker";
import { weekSchema } from "@/lib/server/validation";
import { errorResponse, privateResponse } from "@/lib/server/errors";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const actor = await requireMember();
    const week = weekSchema.parse(
      new URL(request.url).searchParams.get("week") ?? currentWeek(),
    );
    return privateResponse(await dashboard(actor, week));
  } catch (error) {
    return errorResponse(error);
  }
}
