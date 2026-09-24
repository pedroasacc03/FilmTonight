// GET /api/pro/status - current user's tier + beta-Pro slot availability,
// for the blocked-energy notification to decide its copy before the user
// even clicks (grant vs. waitlist framing). The actual grant/waitlist
// decision is still made atomically server-side on POST /api/pro/upgrade -
// this is read-only, for display.
import { NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/session";
import { getBetaProSlotStatus } from "@/lib/proGrant";

export async function GET(request) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const slots = await getBetaProSlotStatus();
  return NextResponse.json({ tier: user.tier, ...slots });
}
