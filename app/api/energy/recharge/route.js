// POST /api/energy/recharge - buy +20 energy for $1.99 (see lib/energy.js
// purchaseRecharge). Reachable from the blocked-energy notification
// (components/EnergyLimitWatcher.js) for any tier. Fake/logged, no real
// Stripe charge - see that function's comment.
import { NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/session";
import { purchaseRecharge, getEnergyStatus } from "@/lib/energy";

export async function POST(request) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { energyAdded } = await purchaseRecharge(user.id, user.tier);
  const status = await getEnergyStatus(user.id, user.tier);
  return NextResponse.json({ energyAdded, status });
}
