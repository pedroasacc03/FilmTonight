// GET   /api/recommendations - list pending AI picks awaiting a decision
// POST  /api/recommendations - generate a fresh batch of AI recommendations
// PATCH /api/recommendations - triage one: watched / wishlisted / not interested
//       (closes the loop back into the Rating table, which the Watched and
//       Wishlist pages read from)
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserFromRequest } from "@/lib/session";
import { listRecommendations, generateRecommendations, checkRecommendationEligibility } from "@/lib/recommendations";
import { maybeAnalyzePreferences } from "@/lib/profile";
import { checkRateLimit, formatRetryAfter } from "@/lib/rateLimit";
import { trackWatchedMilestones, trackEvent } from "@/lib/events";
import { checkAndSpendEnergy, refundEnergy, buildEnergyLimitBody } from "@/lib/energy";

// Maps a Recommendation-card triage action to the underlying Rating status -
// the two use different vocabularies (Recommendation has no "want_to_watch").
const RATING_STATUS_FOR_ACTION = {
  watched: "watched",
  not_interested: "not_interested",
  wishlisted: "want_to_watch",
};

export async function GET(request) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const recommendations = await listRecommendations(user.id);
  return NextResponse.json({ recommendations });
}

export async function POST(request) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  // Gate first, before spending a rate-limit slot on a request that's going
  // to be rejected anyway - see lib/recommendations.js for why this exists
  // (recommendations need real signal to not just be generic guesses).
  const eligibility = await checkRecommendationEligibility(user.id);
  if (!eligibility.eligible) {
    return NextResponse.json(
      {
        error: `You need at least ${eligibility.goal} watched ratings before recommendations unlock - you're at ${eligibility.watchedCount}/${eligibility.goal}. This isn't an arbitrary limit: recommendations are only as good as the taste profile behind them, and with fewer than ${eligibility.goal} ratings there isn't enough signal for the AI to do more than guess generically. Rate a few more titles on the Ratings page, then come back (for even better picks, ${eligibility.suggestedGoal} total is the sweet spot, but it's not required).`,
      },
      { status: 403 }
    );
  }

  const limit = await checkRateLimit(user.id, "recommendations");
  if (!limit.allowed) {
    return NextResponse.json(
      { error: `You've generated a lot of recommendations recently - try again in ${formatRetryAfter(limit.retryAfterSeconds)}.` },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } }
    );
  }

  // Real product-tier gating (unlike the rate limit above, which is an
  // abuse backstop) - UI gating is a courtesy only, this is the actual
  // control. See lib/energy.js.
  const energyResult = await checkAndSpendEnergy(user.id, user.tier, "recommendation_batch");
  if (!energyResult.allowed) {
    return NextResponse.json(buildEnergyLimitBody(energyResult), { status: 429 });
  }

  try {
    const created = await generateRecommendations(user.id);
    trackEvent(user.id, "recommendations_generated", { count: created.length }).catch((err) => {
      console.error("Failed to track recommendations_generated:", err.message);
    });
    return NextResponse.json({ created });
  } catch (err) {
    // The energy was already spent above - refund it, since this failure is
    // an unrelated API/timeout error, not the user "using up" their action.
    await refundEnergy(user.id, "recommendation_batch").catch(() => {});
    console.error("Failed to generate recommendations:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PATCH(request) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const body = await request.json().catch(() => null);
  const { recommendationId, status, reason, stars, why } = body || {};
  if (!recommendationId || !Object.keys(RATING_STATUS_FOR_ACTION).includes(status)) {
    return NextResponse.json({ error: "recommendationId and a valid status are required." }, { status: 400 });
  }

  const recommendation = await prisma.recommendation.findUnique({ where: { id: recommendationId } });
  if (!recommendation || recommendation.userId !== user.id) {
    return NextResponse.json({ error: "Recommendation not found." }, { status: 404 });
  }

  await prisma.recommendation.update({ where: { id: recommendationId }, data: { status } });

  // Recurring (not one-time) - tells us the breakdown of how people react to
  // AI picks over time, distinct from the one-time first_rating/
  // activated_10_watched milestones below.
  trackEvent(user.id, "recommendation_triaged", { status }).catch((err) => {
    console.error("Failed to track recommendation_triaged:", err.message);
  });

  // Triaging a recommendation closes the loop back into the Rating table -
  // exactly like rating a title directly would - which is what the Watched
  // and Wishlist pages read from. `reason` (not-interested) and `why` (a
  // rating given via the Mark Watched prompt) both land in the same "why"
  // column - the single most useful signal for the AI Preference Analysis
  // Engine - whichever one this action actually supplied.
  const ratingStatus = RATING_STATUS_FOR_ACTION[status];
  const noteText = why ?? reason;
  await prisma.rating.upsert({
    where: { userId_titleId: { userId: user.id, titleId: recommendation.titleId } },
    update: { status: ratingStatus, why: noteText || undefined, stars: stars ?? undefined },
    create: {
      userId: user.id,
      titleId: recommendation.titleId,
      status: ratingStatus,
      why: noteText || null,
      stars: stars ?? null,
      source: "form",
    },
  });

  // Don't block the response on this - it's a real Claude API call and the
  // UI is only waiting to know the status change was saved. Batched - see
  // lib/profile.js maybeAnalyzePreferences.
  maybeAnalyzePreferences(user.id).catch((err) => {
    console.error("Failed to re-analyze preferences after recommendation action:", err.message);
  });

  // Marking a recommendation "watched" writes a Rating row too (above), just
  // like the Ratings page's own POST /api/ratings does - so the same
  // activation-funnel milestones need to fire here as well, or a user who
  // only ever triages recommendations (never rates through the Ratings page
  // directly) would never trip first_rating/activated_10_watched at all.
  if (ratingStatus === "watched") {
    await trackWatchedMilestones(user.id).catch((err) => {
      console.error("Failed to track watched-rating milestones:", err.message);
    });
  }

  return NextResponse.json({ ok: true });
}
