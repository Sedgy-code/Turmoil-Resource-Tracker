import { z } from "zod";
import { requireMember } from "@/lib/server/auth";
import { assertSameOrigin } from "@/lib/server/config";
import { listApplications, submitApplication } from "@/lib/server/applications";
import { errorResponse, privateResponse } from "@/lib/server/errors";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const text = (max: number) => z.string().trim().max(max).default("");
const schema = z.object({
  gameName: z.string().trim().min(1).max(40),
  discordName: z.string().trim().min(2).max(40),
  power: text(20),
  stage: text(20),
  server: text(20),
  timezone: text(20),
  warDays: text(20),
  languages: text(80),
  about: text(1000),
  // Hidden field people never see; bots fill it in.
  website: z.string().max(0).optional(),
});

/** Leadership: every application. */
export async function GET() {
  try { return privateResponse(await listApplications(await requireMember())); }
  catch (error) { return errorResponse(error); }
}

/** Anyone: send an application (no sign-in needed). */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const input = schema.parse(await request.json());
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
    const application = await submitApplication(input, ip);
    return privateResponse({ ok: true, id: application.id });
  } catch (error) {
    return errorResponse(error);
  }
}
