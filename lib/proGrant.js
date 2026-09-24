// The pre-launch monetization test: a capped number of free "beta Pro"
// grants (no payment, no Stripe) that instantly give real Pro-level access,
// as a way to test upgrade demand before real billing exists. Every grant
// is real AI spend with zero revenue behind it - BETA_PRO_MAX_SLOTS is what
// bounds that exposure. See prisma/schema.prisma's ProInterest model and
// lib/energy.js (which treats beta_pro and pro identically).

import { prisma } from "@/lib/prisma";
import { getEnergyCeiling } from "@/lib/energy";

export const BETA_PRO_MAX_SLOTS = Number(process.env.BETA_PRO_MAX_SLOTS) || 100;

// Shown on /pro. "annual" is a healthy-margin default (49 = ~18% off
// monthly x12) - swap it if a different annual price is wanted. Both are
// display-only today; see createProUpgradeIntent for the actual (fake)
// grant, and its TODO for where real Stripe prices/price IDs would plug in.
export const PRICING_CONFIG = {
  monthly: { amount: 5, label: "$5/mo", cycle: "monthly" },
  annual: { amount: 49, label: "$49/yr", cycle: "annual" },
};

/**
 * How many beta slots are left, for display on /pro and admin metrics.
 * Grants are one-directional (no expiry, no manual reclaim modeled here -
 * see the file header) so this only ever counts down.
 */
export async function getBetaProSlotStatus() {
  const grantedCount = await prisma.proInterest.count({ where: { grantedBetaPro: true } });
  return {
    maxSlots: BETA_PRO_MAX_SLOTS,
    grantedCount,
    slotsRemaining: Math.max(0, BETA_PRO_MAX_SLOTS - grantedCount),
  };
}

/**
 * The fake-grant flow. Idempotent per user (ProInterest.userId is unique):
 * a user who already has a row - granted OR waitlisted - gets that same
 * row's outcome back unchanged; only a user with no row yet gets a fresh
 * decision. This is what makes "clicking again is a no-op" and "falls back
 * to the waitlist once slots run out" both true from the same code path.
 *
 * The slot cap itself is enforced with a Prisma interactive transaction
 * (count-then-create), not a single atomic updateMany like lib/energy.js's
 * spend check - Prisma can't express "insert only if count(x) < N" as one
 * conditional write. This matches lib/rateLimit.js's own stated tradeoff
 * for this single-instance SQLite app (good enough here; a multi-instance
 * deployment would want a DB-level constraint or advisory lock instead).
 *
 * TODO: replace the grant branch below with
 * stripe.checkout.sessions.create(...) + a webhook that sets tier="pro" on
 * successful payment (and tier="free" for anyone who doesn't convert). This
 * function is the one seam to swap when real billing exists - no other file
 * needs to change to make that switch, since every caller here only ever
 * sees { granted, waitlisted, alreadyRecorded }.
 */
export async function createProUpgradeIntent({ userId, email, source, billingCycleSelected }) {
  const existing = await prisma.proInterest.findUnique({ where: { userId } });
  if (existing) {
    return { granted: existing.grantedBetaPro, waitlisted: !existing.grantedBetaPro, alreadyRecorded: true };
  }

  const { granted } = await prisma.$transaction(async (tx) => {
    const grantedCount = await tx.proInterest.count({ where: { grantedBetaPro: true } });
    const granted = grantedCount < BETA_PRO_MAX_SLOTS;

    await tx.proInterest.create({
      data: {
        userId,
        email,
        source,
        billingCycleSelected,
        grantedBetaPro: granted,
        grantedAt: granted ? new Date() : null,
      },
    });

    if (granted) {
      await tx.user.update({ where: { id: userId }, data: { tier: "beta_pro" } });
      // Top up to the pro ceiling immediately, rather than leaving whatever
      // free-tier remainder they had - the grant should feel real right away.
      await tx.userEnergy.upsert({
        where: { userId },
        update: { energy: getEnergyCeiling("beta_pro"), lastRefillAt: new Date() },
        create: { userId, energy: getEnergyCeiling("beta_pro"), lastRefillAt: new Date() },
      });
    }

    return { granted };
  });

  return { granted, waitlisted: !granted, alreadyRecorded: false };
}
