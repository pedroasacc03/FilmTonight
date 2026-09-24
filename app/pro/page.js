// The /pro page - reachable from the NavBar's "Upgrade"/"Pro" link and from
// the energy-limit notification's primary button (which grants directly,
// without navigating here - this page is for browsing pricing and granting
// from a deliberate visit instead). See lib/proGrant.js for the underlying
// (real, no-payment) grant logic this page's client half calls.

import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { trackPageView } from "@/lib/events";
import { getBetaProSlotStatus, PRICING_CONFIG } from "@/lib/proGrant";
import { getEnergyStatus } from "@/lib/energy";
import NavBar from "@/components/NavBar";
import ProPageClient from "@/components/ProPageClient";

export default async function ProPage() {
  const user = await requireUser();
  await trackPageView(user.id, "pro").catch((err) => console.error("Failed to track page view:", err.message));

  const [slots, energyStatus, existingInterest] = await Promise.all([
    getBetaProSlotStatus(),
    getEnergyStatus(user.id, user.tier),
    prisma.proInterest.findUnique({ where: { userId: user.id }, select: { grantedBetaPro: true } }),
  ]);

  return (
    <>
      <NavBar activePath="/pro" />
      <div className="page narrow">
        <h1>FilmTonight Pro</h1>
        <ProPageClient
          tier={user.tier}
          slots={slots}
          pricing={PRICING_CONFIG}
          existingInterest={existingInterest}
          energyStatus={energyStatus}
        />
      </div>
    </>
  );
}
