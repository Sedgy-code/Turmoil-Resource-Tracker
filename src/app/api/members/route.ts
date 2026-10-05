import { requireMember } from "@/lib/server/auth";
import { listMembers } from "@/lib/server/tracker";
import { errorResponse, privateResponse } from "@/lib/server/errors";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    return privateResponse({
      members: await listMembers(await requireMember()),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
