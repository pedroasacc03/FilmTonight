// The /pro page - reachable from the NavBar's "Upgrade"/"Pro" link and from
// the energy-limit notification's primary button (which grants directly,
// without navigating here - this page is for browsing pricing and granting
// from a deliberate visit instead). See lib/proGrant.js for the underlying
// (real, no-payment) grant logic this page's client half calls.

import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { trackPageView } from "@/lib/events";
import { getBetaProSlotStatus, PRICING_CONFIG } from "@/lib/proGrant";
import { getEnergyStatus, getEnergyCeiling, RECHARGE_ENERGY_AMOUNT, RECHARGE_PRICE_USD } from "@/lib/energy";
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
      <div className="page">
        <h1>FilmTonight Pro</h1>
        <p className="muted" style={{ maxWidth: 640, marginBottom: 12 }}>
          Recommendation batches, chat messages, and Surprise Me picks each cost 1 energy. Rating titles and
          building your taste profile is always free and unlimited, on every plan.
        </p>
        <p className="muted" style={{ maxWidth: 640, marginBottom: 32 }}>
          <strong>There&apos;s no real Pro subscription to buy yet</strong> - billing isn&apos;t live. While
          we&apos;re in beta, a limited number of people can unlock full Pro access for free instead - that&apos;s
          what &quot;beta Pro&quot; means below. The pricing further down previews what Pro will cost once real
          billing exists; it isn&apos;t something you can pay for today.
        </p>

        <div className="two-col" style={{ marginBottom: 24 }}>
          <div className="card">
            <h3 style={{ marginTop: 0 }}>Free</h3>
            <ul>
              {/* Read live rather than hardcoded - a stale copy of this
                  number is exactly the kind of thing that quietly drifts
                  out of sync with lib/energy.js on the next config change. */}
              <li>
                {getEnergyCeiling("free")} energy a day - mix and match recommendations, chat, and Surprise Me
                however you like
              </li>
              <li>Unlimited ratings and taste-profile building</li>
              <li>Full access to Wishlist, Watched, and My Preferences</li>
            </ul>
          </div>
          <div className="card" style={{ borderColor: "var(--color-accent)" }}>
            <h3 style={{ marginTop: 0, color: "var(--color-accent)" }}>Pro (beta Pro, for now)</h3>
            <ul>
              <li>{getEnergyCeiling("pro")} energy a day - marketed as &quot;Unlimited&quot; since real use rarely if ever hits it</li>
              <li>Everything in Free</li>
            </ul>
          </div>
        </div>

        <p className="muted" style={{ maxWidth: 640, marginBottom: 40 }}>
          Need more energy the same day, on any plan? Buy +{RECHARGE_ENERGY_AMOUNT} energy for ${RECHARGE_PRICE_USD.toFixed(2)}
          , anytime - it stacks on top of what you already have and never expires. You&apos;ll see this offered
          directly whenever you run out.
        </p>

        <div style={{ maxWidth: 480 }}>
          <ProPageClient
            tier={user.tier}
            slots={slots}
            pricing={PRICING_CONFIG}
            existingInterest={existingInterest}
            energyStatus={energyStatus}
          />
        </div>
      </div>
    </>
  );
}
