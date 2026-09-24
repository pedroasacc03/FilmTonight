// Turns a user's preference profile into actual recommendations, per
// Section 4.2 of the planning doc: candidate generation -> enrichment via
// findOrLookupTitle -> de-duplication against what's already known.

import { prisma } from "@/lib/prisma";
import { askClaudeForJSON, getProfileModel, sumUsage } from "@/lib/anthropic";
import { findOrLookupTitle, deserializeTitle } from "@/lib/titles";
import { getProfile, profileToPromptSummary } from "@/lib/profile";
import { RATINGS_GOAL, RECOMMENDED_RATINGS_GOAL } from "@/lib/questions";
import { trackCostEvent, EVENT_NAMES } from "@/lib/events";

/**
 * Whether a user has enough signal for recommendations to work at all: at
 * least RATINGS_GOAL watched ratings, AND an AI-built profile actually
 * exists (analyzePreferences runs after every watched rating, so by
 * RATINGS_GOAL this should already be true in practice - checking it
 * explicitly rather than assuming covers the edge case where it hasn't
 * finished yet). Used to gate both "Generate more picks" and "Surprise Me" -
 * see app/api/recommendations/route.js and
 * app/api/recommendations/surprise/route.js - and to show the same numbers
 * transparently on the Recommendations page before the user even tries.
 *
 * `metSuggestedGoal` is never a gate, just a flag for callers that want to
 * show a "you've hit the recommended goal too" nudge (or hide the RATINGS_GOAL
 * one) once the user's past RECOMMENDED_RATINGS_GOAL as well.
 */
export async function checkRecommendationEligibility(userId) {
  const [watchedCount, profile] = await Promise.all([
    prisma.rating.count({ where: { userId, status: "watched" } }),
    getProfile(userId),
  ]);

  return {
    eligible: watchedCount >= RATINGS_GOAL && !!profile,
    watchedCount,
    goal: RATINGS_GOAL,
    suggestedGoal: RECOMMENDED_RATINGS_GOAL,
    metSuggestedGoal: watchedCount >= RECOMMENDED_RATINGS_GOAL,
  };
}

// The Recommendations page is a queue of AI picks still awaiting a decision -
// once the user triages one (Watched / Wishlist / Not Interested), its status
// flips away from "pending" (see the PATCH handler in app/api/recommendations)
// so it naturally drops out of this list. The Wishlist and Watched pages are
// the single source of truth for those lists (read from Rating, not here).
export async function listRecommendations(userId) {
  const rows = await prisma.recommendation.findMany({
    where: { userId, status: "pending" },
    include: { title: true },
    orderBy: { createdAt: "desc" },
  });

  return rows.map((r) => ({ ...r, title: deserializeTitle(r.title) }));
}

// Every title the user wants to watch - the Wishlist page's list. Rating is
// the single source of truth for this (not Recommendation), whether the item
// was added directly on the Wishlist page or via "Add to Wishlist" on a
// Recommendations card.
export async function listWishlist(userId) {
  const rows = await prisma.rating.findMany({
    where: { userId, status: "want_to_watch" },
    include: { title: true },
    orderBy: { updatedAt: "desc" },
  });

  return rows.map((r) => ({ ...r, title: deserializeTitle(r.title) }));
}

// Shared setup for both generateRecommendations and generateSurprisePick:
// the user's profile, region (for streaming-availability accuracy), and a
// dedup list of every title they already know about (rated or recommended),
// so neither flow suggests something the user has already seen or decided on.
async function gatherRecommendationContext(userId) {
  const [user, profile, ratings, existingRecs] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId } }),
    getProfile(userId),
    prisma.rating.findMany({
      where: { userId },
      include: { title: true },
      orderBy: { updatedAt: "desc" },
      take: 100,
    }),
    prisma.recommendation.findMany({
      where: { userId },
      include: { title: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  ]);

  // Streaming availability is region-specific - user.location (set via the
  // Preferences page, or the region pop-up on this page) tells the title
  // lookup below which country's availability to report.
  const region = user?.location || null;

  const knownTitles = new Set([
    ...ratings.map((r) => `${r.title.name} (${r.title.year || "unknown year"})`),
    ...existingRecs.map((r) => `${r.title.name} (${r.title.year || "unknown year"})`),
  ]);

  // knownTitles (above) is prose fed into the prompt so Claude can TRY to
  // avoid already-known titles - but that's an instruction, not a
  // guarantee, and it can miss (e.g. Claude proposes a title under a
  // slightly different name/year than how it's stored, or just doesn't
  // reliably cross-check a 50+ line list). knownTitleIds is the actual
  // enforcement: once a candidate is resolved to a real Title row (see
  // findOrLookupTitle, which resolves via TMDB - the same real-world title
  // always resolves to the same id, regardless of what name Claude typed),
  // callers below reject it outright if that id is already rated or
  // recommended, no matter what the prompt said.
  const knownTitleIds = new Set([...ratings.map((r) => r.titleId), ...existingRecs.map((r) => r.titleId)]);

  return { user, profile, region, knownTitles, knownTitleIds };
}

/**
 * Generates a fresh batch of AI recommendations for a user: asks Claude to
 * propose real titles based on the user's profile, then looks each one up
 * (caching it) and saves it as a "pending" Recommendation with source "ai_new".
 * Fixed at `movieCount` movies + `tvCount` TV shows per batch (default 2+2 -
 * kept small and evenly split so each "Generate more picks" click stays a
 * manageable, cheap batch rather than a long list to triage).
 */
export async function generateRecommendations(userId, { movieCount = 2, tvCount = 2 } = {}) {
  const { user, profile, region, knownTitles, knownTitleIds } = await gatherRecommendationContext(userId);
  const total = movieCount + tvCount;

  const system = `You are the recommendation engine for a movie/TV platform.
Given a user's taste profile, suggest exactly ${movieCount} movies and ${tvCount} TV shows (${total} total) they
have not seen or been recommended yet.
Every suggestion MUST be a real, specific, existing title - never invent one.
Do not suggest anything in the ALREADY KNOWN list below.
Lean toward the user's favorite genres/themes, but include at least one pick outside their dominant genre for
variety (per the idea that a strong genre lean shouldn't be treated as an exclusive rule) - unless their
profile is too thin to safely diversify, in which case just make your best guesses.

If the profile's "Viewing habits" line mentions any of the following, weigh them when picking candidates - skip any
that aren't mentioned rather than guessing:
  - Runtime/length comfort (e.g. avoids very long movies, fine with many-season TV commitments)
  - A quality bar (e.g. drawn to critically-acclaimed work vs. doesn't care about critical reception)
  - Era/recency preference (recent releases vs. classics)
  - Content rating/maturity fit (e.g. family-friendly for a stated context)
  - Ongoing vs. ended TV shows
If the profile lists "Favorite directors/creators/actors", a new title from one of those specific people is a
strong pick. If it lists demographics/origin openness, factor that in too.

Respond with ONLY a JSON array (no prose, no markdown code fences) of exactly ${total} objects (${movieCount} with
"type": "movie" and ${tvCount} with "type": "tv"), shaped like:
{ "name": string, "year": number or null, "type": "movie" or "tv", "reasonText": string (1-2 sentences, specific to this user, e.g. "Matches your love of earned plot twists and morally grey characters like in Breaking Bad") }`;

  const prompt = `USER TASTE PROFILE:
${profileToPromptSummary(profile, user)}

ALREADY KNOWN (do not recommend these again):
${knownTitles.size ? [...knownTitles].join(", ") : "(none yet)"}

Suggest ${movieCount} movies and ${tvCount} TV shows now.`;

  // usage is tracked in `finally` so a malformed-JSON response (a real,
  // billed call that just failed to parse) still gets its cost recorded -
  // see askClaudeForJSON's comment on why the error carries `usage` too.
  let usage;
  let rawCandidates;
  try {
    const response = await askClaudeForJSON({ system, prompt, maxTokens: 1500, model: getProfileModel() });
    usage = response.usage;
    rawCandidates = response.data;
  } catch (err) {
    if (err.usage) usage = err.usage;
    throw err;
  } finally {
    await trackCostEvent(userId, EVENT_NAMES.COST_RECOMMENDATIONS_BATCH, usage);
  }
  if (!Array.isArray(rawCandidates)) return [];

  // "Exactly movieCount movies and tvCount TV shows" above is an
  // instruction, not a guarantee - Claude has returned more than asked for
  // (verified: a batch meant to be 2+2 came back as 5). Enforce the count
  // and the movie/TV split in code instead of trusting the model's count -
  // anything with a missing/invalid "type" is dropped rather than risking
  // an uncapped extra candidate slipping through.
  const candidates = [
    ...rawCandidates.filter((c) => c?.type === "movie").slice(0, movieCount),
    ...rawCandidates.filter((c) => c?.type === "tv").slice(0, tvCount),
  ];

  // Look up every candidate concurrently rather than one at a time - these
  // are independent network calls (TMDB/OMDb, see lib/titles.js), so running
  // them sequentially was pure wasted latency: a 4-candidate batch waited
  // for 4 full round-trips back to back instead of the time of just one.
  const validCandidates = candidates.filter((c) => c?.name);
  const lookups = await Promise.allSettled(
    validCandidates.map((candidate) =>
      findOrLookupTitle(candidate.name, { year: candidate.year || undefined, type: candidate.type, region })
    )
  );

  const created = [];
  for (let i = 0; i < validCandidates.length; i++) {
    const candidate = validCandidates[i];
    const result = lookups[i];
    if (result.status === "rejected") {
      // One bad candidate (e.g. a lookup hiccup) shouldn't fail the whole batch.
      console.error(`Skipping recommendation candidate "${candidate.name}":`, result.reason?.message);
      continue;
    }
    const title = result.value;
    if (!title) continue; // couldn't confirm this was a real title - skip it
    if (knownTitleIds.has(title.id)) {
      // Claude proposed something the user has already rated or been
      // recommended, despite the ALREADY KNOWN list in the prompt - enforce
      // it in code rather than trusting the prompt alone. See the comment
      // on knownTitleIds in gatherRecommendationContext.
      console.error(`Skipping recommendation candidate "${candidate.name}": already known to this user`);
      continue;
    }

    const rec = await prisma.recommendation.upsert({
      where: { userId_titleId: { userId, titleId: title.id } },
      update: { reasonText: candidate.reasonText || "", source: "ai_new", status: "pending" },
      create: {
        userId,
        titleId: title.id,
        reasonText: candidate.reasonText || "",
        source: "ai_new",
        status: "pending",
      },
    });
    created.push({ ...rec, title });
  }
  return created;
}

/**
 * "Surprise Me": generates exactly ONE title that's a deliberate stretch
 * outside the user's usual taste - not a random pick, but one grounded in a
 * real connecting thread in their profile (a theme, a director/actor they
 * like, a storytelling quality) - so the "why" can actually explain the
 * stretch. Saved as a "pending" Recommendation with source "surprise", same
 * as any other pick, so it goes through the normal Watched/Wishlist/Not
 * Interested triage on the Recommendations page.
 */
const SURPRISE_PICK_MAX_ATTEMPTS = 2;

export async function generateSurprisePick(userId) {
  const { user, profile, region, knownTitles, knownTitleIds } = await gatherRecommendationContext(userId);

  // A collision here (Claude proposes something the user already knows,
  // despite the ALREADY KNOWN list) fails the user's one and only pick, not
  // just one candidate out of a batch - so unlike generateRecommendations,
  // this retries once with that title added to the avoid-list by name,
  // instead of giving up on the first collision.
  const extraAvoid = new Set();
  // Accumulates usage across every attempt (1 or 2) this call makes, so the
  // cost event fired below reflects the full cost of producing (or failing
  // to produce) this one surprise pick - not just its last API call.
  const usageList = [];

  for (let attempt = 0; attempt < SURPRISE_PICK_MAX_ATTEMPTS; attempt++) {
    const system = `You are the "Surprise Me" feature for a movie/TV platform. Unlike a normal recommendation, your
job is NOT to stay close to the user's established taste - it's to suggest ONE real, specific title that sits
noticeably outside their comfort zone (a different genre, tone, pace, or era than what they usually watch), while
still being a THOUGHTFUL pick they might genuinely enjoy - grounded in some real, specific connecting thread in
their profile (a theme they respond to, a storytelling quality, a director/actor they already like, an emotional
throughline), not picked at random. If you can't find a real connecting thread, pick something more mainstream
and well-regarded within the stretch category rather than something obscure with no bridge to their taste at all.
Do not suggest anything in the ALREADY KNOWN list below.

Respond with ONLY a single JSON object (no prose, no markdown code fences):
{
  "name": string,
  "year": number or null,
  "type": "movie" or "tv",
  "whyOutsideComfortZone": string (one sentence on what makes this a stretch for them specifically),
  "whyTheyMightLikeIt": string (1-2 sentences on the genuine connecting thread to their taste - be specific, not generic)
}`;

    const prompt = `USER TASTE PROFILE:
${profileToPromptSummary(profile, user)}

ALREADY KNOWN (do not recommend these again):
${knownTitles.size || extraAvoid.size ? [...knownTitles, ...extraAvoid].join(", ") : "(none yet)"}

Suggest one surprising-but-thoughtful pick now.`;

    // Tracked via usageList regardless of success/failure - a malformed-JSON
    // response is still a real, billed call (see askClaudeForJSON's comment
    // on why the error carries `usage` too), and this loop can retry once
    // more after this, so the final cost event (fired after the loop, or on
    // an early return below) needs every attempt's usage, not just the last.
    let candidate;
    try {
      const response = await askClaudeForJSON({ system, prompt, maxTokens: 500, model: getProfileModel() });
      candidate = response.data;
      usageList.push(response.usage);
    } catch (err) {
      usageList.push(err.usage);
      await trackCostEvent(userId, EVENT_NAMES.COST_SURPRISE_PICK, sumUsage(usageList));
      throw err;
    }
    if (!candidate?.name) {
      await trackCostEvent(userId, EVENT_NAMES.COST_SURPRISE_PICK, sumUsage(usageList));
      return null;
    }

    const title = await findOrLookupTitle(candidate.name, {
      year: candidate.year || undefined,
      type: candidate.type,
      region,
    });
    if (!title) {
      await trackCostEvent(userId, EVENT_NAMES.COST_SURPRISE_PICK, sumUsage(usageList));
      return null;
    }

    if (knownTitleIds.has(title.id)) {
      // Enforce the "already known" rule in code, same as generateRecommendations
      // - the prompt is an instruction, not a guarantee. Try once more with
      // this specific title now named explicitly, rather than failing outright.
      extraAvoid.add(`${title.name} (${title.year || "unknown year"})`);
      continue;
    }

    const reasonText = [candidate.whyOutsideComfortZone, candidate.whyTheyMightLikeIt].filter(Boolean).join(" ");

    const rec = await prisma.recommendation.upsert({
      where: { userId_titleId: { userId, titleId: title.id } },
      update: { reasonText, source: "surprise", status: "pending" },
      create: { userId, titleId: title.id, reasonText, source: "surprise", status: "pending" },
    });

    await trackCostEvent(userId, EVENT_NAMES.COST_SURPRISE_PICK, sumUsage(usageList));
    return { ...rec, title };
  }

  await trackCostEvent(userId, EVENT_NAMES.COST_SURPRISE_PICK, sumUsage(usageList));
  return null; // both attempts collided with an already-known title
}
