// Lightweight, first-party product-analytics event log. Deliberately NOT a
// third-party tool (no PostHog/Segment/etc.) - events are just rows in the
// Event table, in our own database, queryable directly (Prisma Studio or a
// script) and never sent anywhere else. This keeps the "no analytics SDK,
// no third party besides Anthropic" commitment in the Privacy Policy true.
//
// Tracks the activation funnel: "signup" -> "first_rating" ->
// "activated_10_watched" (the 10-watched-ratings activation metric) - plus
// broader behavioral visibility for testing with real users: page views,
// feature-usage events (search, recommendations, chat, profile edits, etc.),
// and a daily "active_day" signal for retention. See app/admin/metrics/page.js
// for where all of this surfaces.

import { prisma } from "@/lib/prisma";

const WATCHED_ACTIVATION_THRESHOLD = 10;

// Every page-view/feature event name this file (or a route) can fire, purely
// so app/admin/metrics/page.js has one place to import the full list from
// instead of the event names living only as string literals scattered across
// route handlers.
export const EVENT_NAMES = {
  SIGNUP: "signup",
  FIRST_RATING: "first_rating",
  ACTIVATED_10_WATCHED: "activated_10_watched",
  ACTIVE_DAY: "active_day",
  PAGE_VIEW: "page_view",
  SEARCH_PERFORMED: "search_performed",
  SHOW_OTHER_MATCHES_USED: "show_other_matches_used",
  RATING_SAVED: "rating_saved",
  RATING_DELETED: "rating_deleted",
  RECOMMENDATIONS_GENERATED: "recommendations_generated",
  SURPRISE_PICK_GENERATED: "surprise_pick_generated",
  RECOMMENDATION_TRIAGED: "recommendation_triaged",
  CHAT_MESSAGE_SENT: "chat_message_sent",
  CHAT_CLEARED: "chat_cleared",
  PROFILE_EDITED: "profile_edited",
  PROFILE_REANALYZED: "profile_reanalyzed",
  LANDING_VIEW: "landing_view",
};

/**
 * Records an event. `userId` may be null for events that happen before
 * anyone has an account (currently just "landing_view" - see
 * trackAnonymousEvent below). Also logs a structured one-line console
 * message so events are visible in server logs during development without
 * needing to query the DB.
 */
export async function trackEvent(userId, name, metadata) {
  await prisma.event.create({
    data: { userId, name, metadata: metadata ? JSON.stringify(metadata) : null },
  });
  console.log(`[event] ${name} user=${userId ?? "(anonymous)"}${metadata ? " " + JSON.stringify(metadata) : ""}`);
}

/**
 * Records an event with no associated user - for pre-signup activity like a
 * landing-page view. A thin wrapper over trackEvent(null, ...) that exists
 * mainly so call sites read clearly as "this visitor isn't a user yet."
 */
export async function trackAnonymousEvent(name, metadata) {
  await trackEvent(null, name, metadata);
}

/**
 * Records `name` for `userId` only the first time it happens - use this for
 * one-time milestone events so they never get double-logged even if the
 * underlying count fluctuates later (e.g. a user deletes their one rating
 * and re-adds one, or deletes ratings after crossing 10 watched).
 */
export async function trackEventOnce(userId, name, metadata) {
  const existing = await prisma.event.findFirst({ where: { userId, name } });
  if (existing) return;
  await trackEvent(userId, name, metadata);
}

/**
 * Fires the "first_rating" and "activated_10_watched" milestone events, if
 * they haven't already fired for this user. Call this after saving ANY
 * rating with status "watched" - there are two call sites that can do that
 * (POST /api/ratings, and the Recommendations page's triage PATCH), so this
 * lives here rather than in either route, to avoid missing one. Both
 * underlying events are idempotent (trackEventOnce), so calling this on
 * every watched-rating save, including edits to an existing one, is safe.
 */
export async function trackWatchedMilestones(userId) {
  await trackEventOnce(userId, EVENT_NAMES.FIRST_RATING);

  const watchedCount = await prisma.rating.count({ where: { userId, status: "watched" } });
  if (watchedCount >= WATCHED_ACTIVATION_THRESHOLD) {
    await trackEventOnce(userId, EVENT_NAMES.ACTIVATED_10_WATCHED, { watchedCount });
  }
}

/**
 * Records `userId` as active for today (first call of the day only - a
 * cheap existence check on today's rows, not a separate table) - the basis
 * for a simple retention signal (DAU / N-day active users) on the metrics
 * page. Called from trackPageView below, so any page visit counts.
 */
async function markActiveToday(userId) {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const existing = await prisma.event.findFirst({
    where: { userId, name: EVENT_NAMES.ACTIVE_DAY, createdAt: { gte: startOfDay } },
  });
  if (existing) return;
  await trackEvent(userId, EVENT_NAMES.ACTIVE_DAY);
}

/**
 * Records a page view (`page` is a short slug like "home"/"recommendations")
 * and marks the user active for today. Call from the top of each protected
 * page's Server Component, e.g. `await trackPageView(user.id, "ratings")`.
 * This fires on every navigation to that route, including client-side
 * navigation via next/link (the page's Server Component still re-runs), so
 * it reflects real per-visit traffic, not just full page loads.
 */
export async function trackPageView(userId, page) {
  await trackEvent(userId, EVENT_NAMES.PAGE_VIEW, { page });
  await markActiveToday(userId);
}
