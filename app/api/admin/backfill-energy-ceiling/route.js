// POST /api/admin/backfill-energy-ceiling - one-off migration action,
// triggered by the "Fix stale energy balances" button on /admin/metrics.
// See lib/energy.js backfillStaleEnergyCeilings for what it does and why
// it's needed: refillIfStale never decreases energy (on purpose, to
// protect Recharge surplus), so an account that already had a higher
// balance from before FREE_DAILY_ENERGY was tightened (6 -> 4) just kept
// showing that old number instead of ever settling to the new ceiling.
// Admin-only, same gate as the metrics page itself.
import { NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/session";
import { isAdmin } from "@/lib/admin";
import { backfillStaleEnergyCeilings } from "@/lib/energy";

export async function POST(request) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!isAdmin(user)) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }

  try {
    const result = await backfillStaleEnergyCeilings();
    return NextResponse.json(result);
  } catch (err) {
    console.error("Energy ceiling backfill failed:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
