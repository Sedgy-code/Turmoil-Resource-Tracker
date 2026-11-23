import { requireMember } from "@/lib/server/auth";
import { assertSameOrigin } from "@/lib/server/config";
import { announcementChannels, announcementDeleteSchema, announcementSchema, deleteAnnouncement, postAnnouncement } from "@/lib/server/announcements";
import { errorResponse, privateResponse } from "@/lib/server/errors";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Admins: the channels a post can go in (nothing is posted). */
export async function GET() {
  try {
    return privateResponse(await announcementChannels(await requireMember()));
  } catch (error) {
    return errorResponse(error);
  }
}

/** Admins: post a message in a clan Discord channel as the Turmoil bot. */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await requireMember();
    return privateResponse(await postAnnouncement(actor, announcementSchema.parse(await request.json())));
  } catch (error) {
    return errorResponse(error);
  }
}

/** Admins: delete a post the bot (or the reminder webhook) made, such as an announcement being replaced. */
export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await requireMember();
    return privateResponse(await deleteAnnouncement(actor, announcementDeleteSchema.parse(await request.json())));
  } catch (error) {
    return errorResponse(error);
  }
}
