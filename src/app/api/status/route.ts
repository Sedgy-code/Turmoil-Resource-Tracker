import { requireMember } from "@/lib/server/auth";
import { errorResponse, privateResponse } from "@/lib/server/errors";
import { statusBoard } from "@/lib/server/leader";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Every member's clan week at a glance (admins only). */
export async function GET() {
  try {
    return privateResponse(await statusBoard(await requireMember()));
  } catch (error) {
    return errorResponse(error);
  }
}
