import { database } from "@/lib/server/db";
import { applicationSettings } from "@/lib/server/applications";
import { errorResponse, privateResponse } from "@/lib/server/errors";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Public: whether the Apply page is taking applications. */
export async function GET() {
  try { return privateResponse({ open: (await applicationSettings(await database())).open }); }
  catch (error) { return errorResponse(error); }
}
