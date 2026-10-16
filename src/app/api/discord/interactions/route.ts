import { NextResponse } from "next/server";
import { handleInteraction, verifyDiscordSignature } from "@/lib/server/discord-interactions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Discord sends /checkin, /snipe-start and button presses here (Interactions Endpoint URL). */
export async function POST(request: Request) {
  const body = await request.text();
  if (!verifyDiscordSignature(body, request.headers.get("x-signature-ed25519"), request.headers.get("x-signature-timestamp"))) {
    return new NextResponse("Invalid request signature", { status: 401 });
  }
  try {
    return NextResponse.json(await handleInteraction(JSON.parse(body)));
  } catch {
    return NextResponse.json({ type: 4, data: { content: "Something went wrong. Please try again.", flags: 64 } });
  }
}
