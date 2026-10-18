import { requireMember } from "@/lib/server/auth";
import { errorResponse, privateResponse } from "@/lib/server/errors";
import { leaderTodo } from "@/lib/server/leader";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Leadership jobs due right now (admins only). */
export async function GET() {
  try {
    return privateResponse(await leaderTodo(await requireMember()));
  } catch (error) {
    return errorResponse(error);
  }
}
