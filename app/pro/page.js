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
        <p className="muted" style={{ maxWidth: 640, marginBottom: 24 }}>
          Recommendations, chat, and Surprise Me each cost 1 energy - rating and taste-profile building are always
          free. Billing isn&apos;t live yet, so beta Pro below is completely free while spots last.
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
            <h3 style={{ marginTop: 0, color: "var(--color-accent)" }}>Pro</h3>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
              <span
                style={{
                  fontSize: 40,
                  lineHeight: 1,
                  fontFamily: "var(--font-heading)",
                  fontWeight: "var(--font-heading-weight)",
                  color: "var(--color-accent)",
                }}
              >
                {PRICING_CONFIG.monthly.label}
              </span>
              <span className="muted">or {PRICING_CONFIG.annual.label}</span>
            </div>
            <span className="chip chip-neutral" style={{ fontSize: 12, marginBottom: 12, display: "inline-block" }}>
              Free right now - beta access
            </span>
            <ul>
              <li>{getEnergyCeiling("pro")} energy a day - marketed as &quot;Unlimited&quot; since real use rarely if ever hits it</li>
              <li>Everything in Free</li>
            </ul>
          </div>
        </div>

        <div style={{ maxWidth: 480, marginBottom: 32 }}>
          <ProPageClient
            tier={user.tier}
            slots={slots}
            pricing={PRICING_CONFIG}
            existingInterest={existingInterest}
            energyStatus={energyStatus}
          />
        </div>

        <p className="muted" style={{ maxWidth: 640 }}>
          Need more energy the same day, on any plan? Buy +{RECHARGE_ENERGY_AMOUNT} energy for ${RECHARGE_PRICE_USD.toFixed(2)}
          , anytime - it stacks on what you already have, never expires, and is offered automatically whenever you
          run out.
        </p>
      </div>
    </>
  );
}
