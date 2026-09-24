// POST /api/recommendations/surprise - the "Surprise Me" button on the
// Recommendations page. Generates exactly ONE deliberate stretch pick (see
// lib/recommendations.js generateSurprisePick) instead of a full batch, so
// it's a cheap, single-title call, not a repeat of "Generate more picks".
import { NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/session";
import { generateSurprisePick, checkRecommendationEligibility } from "@/lib/recommendations";
import { checkRateLimit, formatRetryAfter } from "@/lib/rateLimit";
import { trackEvent } from "@/lib/events";
import { checkAndSpendEnergy, refundEnergy, buildEnergyLimitBody } from "@/lib/energy";

export async function POST(request) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  // Same gate as "Generate more picks" - a Surprise Me pick is specifically
  // supposed to be grounded in a real thread in your taste profile, so with
  // no real profile yet it can't do the one thing that makes it different
  // from a random pick.
  const eligibility = await checkRecommendationEligibility(user.id);
  if (!eligibility.eligible) {
    return NextResponse.json(
      {
        error: `You need at least ${eligibility.goal} watched ratings before Surprise Me unlocks - you're at ${eligibility.watchedCount}/${eligibility.goal}. A surprise pick is supposed to connect to something real in your taste profile, not just be random - without enough ratings there's no real profile to connect to yet. Rate a few more titles on the Ratings page, then come back (for even better picks, ${eligibility.suggestedGoal} total is the sweet spot, but it's not required).`,
      },
      { status: 403 }
    );
  }

  const limit = await checkRateLimit(user.id, "surprise");
  if (!limit.allowed) {
    return NextResponse.json(
      { error: `You've requested a lot of surprise picks recently - try again in ${formatRetryAfter(limit.retryAfterSeconds)}.` },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } }
    );
  }

  const energyResult = await checkAndSpendEnergy(user.id, user.tier, "surprise_me");
  if (!energyResult.allowed) {
    return NextResponse.json(buildEnergyLimitBody(energyResult), { status: 429 });
  }

  try {
    const created = await generateSurprisePick(user.id);
    if (!created) {
      // Not a real failure (Claude just couldn't find a fresh pick, e.g.
      // both attempts collided with an already-known title) - still refund,
      // since the user didn't get anything for this energy.
      await refundEnergy(user.id, "surprise_me").catch(() => {});
      return NextResponse.json({ error: "Couldn't come up with a surprise pick this time - try again." }, { status: 500 });
    }
    trackEvent(user.id, "surprise_pick_generated").catch((err) => {
      console.error("Failed to track surprise_pick_generated:", err.message);
    });
    return NextResponse.json({ created });
  } catch (err) {
    await refundEnergy(user.id, "surprise_me").catch(() => {});
    console.error("Failed to generate surprise pick:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
