import { requireMember } from "@/lib/server/auth";
import { syncDiscordMembersOnDemand } from "@/lib/server/discord-sync";
import { listMembers } from "@/lib/server/tracker";
import { errorResponse, privateResponse } from "@/lib/server/errors";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const actor = await requireMember();
    // Leaders opening the Members page: check Discord first, so new members and leavers show now.
    const sync = actor.role === "ADMIN" ? await syncDiscordMembersOnDemand() : null;
    const changed = sync && (sync.added.length || sync.removed.length || sync.restored.length);
    return privateResponse({
      members: await listMembers(actor),
      ...(changed ? { discord: { added: sync.added, removed: sync.removed, restored: sync.restored } } : {}),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
