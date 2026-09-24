// GET /api/energy/status - the current user's energy balance, for the
// NavBar's free-tier indicator (see components/NavBar.js). Read-only:
// applies any pending refill (so the number shown is never stale) but never
// spends anything. Returns null when ENERGY_SYSTEM_ENABLED=false, or when
// the caller isn't free tier (Pro/beta_pro never show this indicator -
// checked here too, not just client-side, so a slow client can't flash a
// stale energy count before the tier check hides it).
import { NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/session";
import { getEnergyStatus } from "@/lib/energy";

export async function GET(request) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  // `tier` is always returned (even when `status` is null) so callers like
  // NavBar can use this one endpoint for both the energy bar (free only)
  // and tier-aware labeling (e.g. a "Pro" badge vs. an "Upgrade" nav link).
  if (user.tier !== "free") return NextResponse.json({ status: null, tier: user.tier });

  const status = await getEnergyStatus(user.id, user.tier);
  return NextResponse.json({ status, tier: user.tier });
}
