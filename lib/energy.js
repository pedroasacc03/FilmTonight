// The Duolingo-style "energy" system: a daily allowance that gates the
// three metered AI actions (recommendation batches, chat messages, Surprise
// Me picks). Free and Pro/beta_pro share one code path throughout this file
// - they differ only in which ceiling applies (see getEnergyCeiling) - so
// "beta_pro" (a free, no-Stripe grant - see lib/proGrant.js) and real paid
// "pro" are indistinguishable here by design.
//
// Taste-profile analysis is NOT part of this spend system - it's a side
// effect of rating, not something a user consciously spends energy on. See
// tryClaimProfileAnalysisSlot below and lib/profile.js maybeAnalyzePreferences.
//
// Every write in this file uses an atomic, conditional Prisma `updateMany`
// (never read-then-write) specifically so concurrent requests at a boundary
// (the last point of energy, the last beta slot, the exact moment of UTC
// rollover) can't over-spend or double-refill - see each function's comment
// for which race it closes.

import { prisma } from "@/lib/prisma";

// Real measured per-call costs (2026-09-24, 27 live calls, $0.31 total):
// recommendation batch $0.0092, chat message $0.0093, Surprise Me $0.0059 -
// close enough to each other that a 2:1 weighting isn't justified, so all
// three cost 1 energy. Taste-profile analysis ($0.0154/call, the priciest
// single action) is deliberately NOT in this map - it's debounced
// separately, never spends from a user's balance (see below).
export const ACTION_ENERGY_COST = {
  recommendation_batch: 1,
  chat_message: 1,
  surprise_me: 1,
};

// "Recharge": a one-off top-up, same amount regardless of tier (Free and
// Pro/beta_pro alike - see purchaseRecharge below and
// components/EnergyLimitWatcher.js). Deliberately NOT scaled to the tier's
// daily ceiling - that would make it a worse deal for whichever tier has
// the smaller cap, which defeats the point of offering it as a real
// alternative to waiting. If this became a real Stripe charge: ~$0.185 cost
// for 20 avg-cost actions against ~$1.632 net-of-fee revenue (2.9%+$0.30)
// on a $1.99 charge => ~88.7% margin, a much smaller lift than the full
// subscription (no recurring billing, no webhook state machine) - worth
// prioritizing over real Pro billing if forced to pick one first.
export const RECHARGE_ENERGY_AMOUNT = 20;
export const RECHARGE_PRICE_USD = 1.99;

// Tightened from 6 - safe specifically because Recharge (below) now exists
// as a low-friction paid alternative to a hard wall, so a tighter free cap
// doesn't mean "stuck until tomorrow" the way it used to.
export const FREE_DAILY_ENERGY = 4; // worst case ~4 x $0.0093 x 30 =~ $1.12/mo/user (a fully mixed-day)
// 8 (2x FREE_DAILY_ENERGY, a clean "double the free plan" conversion pitch
// - see app/pro/page.js) - worst case ~3 rec batches + 5 chats/day + 1
// taste-profile analysis/day => ~$2.69/mo/user cost against ~$4.56/mo
// net-of-fee revenue at $5/mo (2.9%+$0.30 card fees) => ~41% margin. Was 7
// (~47% margin) - do not raise further without re-deriving this margin.
export const PRO_DAILY_ENERGY = 8;

// The free/pro gap is a business invariant, not just today's config values -
// asserted at module load (fails the server outright, immediately, rather
// than silently letting a future edit invert it) AND re-checked at every
// call site below, so "pro must always beat free" holds even if someone
// changes these constants without reading this comment.
if (PRO_DAILY_ENERGY <= FREE_DAILY_ENERGY) {
  throw new Error(
    `Energy invariant violated: PRO_DAILY_ENERGY (${PRO_DAILY_ENERGY}) must be strictly greater than FREE_DAILY_ENERGY (${FREE_DAILY_ENERGY}).`
  );
}

// Single source of truth for "which ceiling applies" - beta_pro and pro
// both take this branch; only "free" gets the lower one. Every call site in
// this file goes through this function rather than reading FREE_DAILY_ENERGY/
// PRO_DAILY_ENERGY directly, so there's exactly one place that could get the
// free/pro branch backwards.
export function getEnergyCeiling(tier) {
  const ceiling = tier !== "free" ? PRO_DAILY_ENERGY : FREE_DAILY_ENERGY;
  // Belt-and-suspenders: re-assert the invariant against the actual values
  // this call is about to return, not just the constants at module load -
  // cheap (two comparisons) and catches a future refactor that computes the
  // ceiling some other way without touching the check above.
  if (tier !== "free" && ceiling <= FREE_DAILY_ENERGY) {
    throw new Error("Energy invariant violated: a non-free tier resolved to a ceiling at or below the free ceiling.");
  }
  return ceiling;
}

// Whole system kill switch - default on. When off, every function below
// short-circuits to "always allowed, no DB writes, no logs" so the app
// behaves exactly as it did before this feature existed. Read once per
// call (not cached at module scope) so a `.env` change takes effect on the
// next request without a server restart in dev.
function isEnergySystemEnabled() {
  return process.env.ENERGY_SYSTEM_ENABLED !== "false";
}

function nextUtcMidnight(from = new Date()) {
  return new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + 1, 0, 0, 0, 0));
}

function startOfUtcDay(from = new Date()) {
  return new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), 0, 0, 0, 0));
}

// Lazily creates a UserEnergy row at the tier's full ceiling if one doesn't
// exist yet - covers both brand-new signups (app/api/register/route.js also
// calls this eagerly, so a fresh account's first page view already shows a
// full bar) and accounts that existed before this feature shipped (no
// migration/backfill script needed - they just get topped up the first time
// any of this is touched).
async function ensureUserEnergy(userId, tier) {
  return prisma.userEnergy.upsert({
    where: { userId },
    update: {},
    create: { userId, energy: getEnergyCeiling(tier), lastRefillAt: new Date() },
  });
}

// Refills to the full ceiling if the last refill was before today's UTC
// midnight - but only ever UP, never down. Recharge-purchased energy (see
// purchaseRecharge) stacks on the current balance and explicitly never
// expires at midnight; a blind "set energy to ceiling" here would silently
// wipe out any banked recharge surplus sitting above the ceiling. So this
// is two conditional writes instead of one: top up to the ceiling only for
// a user who's below it, and for a user already at/above it (recharge
// surplus, or just hasn't spent anything), only bump the timestamp so
// today's refill isn't re-attempted on every request.
//
// The `where: { lastRefillAt: { lt: todayStart } }` clause (not a blind
// write) on EACH of these is what makes them race-safe: if two requests
// both see a stale row and both attempt the same branch, only the first
// write actually matches the condition at the moment it runs (lastRefillAt
// is now `new Date()`, which is >= todayStart) - the second becomes a
// no-op (count: 0). Same atomic-conditional-update pattern as the spend
// check below, applied to the same race shape.
async function refillIfStale(userId, tier) {
  const now = new Date();
  const todayStart = startOfUtcDay(now);
  const ceiling = getEnergyCeiling(tier);

  await prisma.userEnergy.updateMany({
    where: { userId, lastRefillAt: { lt: todayStart }, energy: { lt: ceiling } },
    data: { energy: ceiling, lastRefillAt: now },
  });
  await prisma.userEnergy.updateMany({
    where: { userId, lastRefillAt: { lt: todayStart }, energy: { gte: ceiling } },
    data: { lastRefillAt: now },
  });
}

/**
 * Read-only status for display (the NavBar energy indicator, the /pro
 * page) - ensures the row exists and applies any pending refill first, so
 * the number shown is never stale, but never spends anything. Returns null
 * when the whole system is disabled (callers should render nothing).
 *
 * `energy` is NOT clamped to `ceiling` - a user can legitimately be above
 * it after buying Recharge (see purchaseRecharge), and that surplus must
 * stay visible, not be silently hidden back down to the daily cap. Callers
 * that render "X/Y" need to handle energy > ceiling themselves (see
 * components/NavBar.js).
 */
export async function getEnergyStatus(userId, tier) {
  if (!isEnergySystemEnabled()) return null;

  await ensureUserEnergy(userId, tier);
  await refillIfStale(userId, tier);
  const row = await prisma.userEnergy.findUnique({ where: { userId } });

  return {
    tier,
    energy: row.energy,
    ceiling: getEnergyCeiling(tier),
    resetAt: nextUtcMidnight(),
  };
}

/**
 * The gate for all three metered actions. Ensures the row exists, applies
 * any pending refill, then attempts a single atomic conditional decrement -
 * `where: { energy: { gte: cost } }` means the write only applies if there
 * was enough energy AT THE MOMENT IT RAN, not at the moment it was checked,
 * so two concurrent requests racing for the last point of energy can't both
 * succeed (the second's `updateMany` sees the already-decremented value and
 * matches nothing). Logs every attempt (spent or blocked) to EnergyLog
 * either way, for the admin metrics + audit trail.
 *
 * Returns { allowed: true, energyRemaining, resetAt } or
 * { allowed: false, energyRemaining, resetAt, tier, action, ceiling }, the
 * last shape matching the 429 body every metered route returns verbatim.
 * `ceiling` is included specifically so the client (a "use client"
 * component that can't safely import this server-only file - it pulls in
 * Prisma) can state the real per-tier daily number without a separate
 * fetch or a duplicated constant - see components/EnergyLimitWatcher.js.
 */
export async function checkAndSpendEnergy(userId, tier, action) {
  const cost = ACTION_ENERGY_COST[action];
  if (!cost) throw new Error(`Unknown energy action: "${action}"`);

  if (!isEnergySystemEnabled()) {
    return { allowed: true, energyRemaining: null, resetAt: null };
  }

  await ensureUserEnergy(userId, tier);
  await refillIfStale(userId, tier);

  const result = await prisma.userEnergy.updateMany({
    where: { userId, energy: { gte: cost } },
    data: { energy: { decrement: cost } },
  });

  const allowed = result.count > 0;
  const row = await prisma.userEnergy.findUnique({ where: { userId } });
  const resetAt = nextUtcMidnight();

  await prisma.energyLog.create({
    data: { userId, action, cost, blocked: !allowed },
  });

  return { allowed, energyRemaining: row.energy, resetAt, tier, action, ceiling: getEnergyCeiling(tier) };
}

/**
 * Refunds `cost` energy after a metered action's Claude call fails for an
 * unrelated reason (timeout, API error - not a business-logic rejection,
 * which never reaches this point since checkAndSpendEnergy already blocked
 * it). Plain increment, not re-clamped to the ceiling under a transaction -
 * a refund racing a same-moment UTC refill could in principle push energy
 * slightly above the ceiling; given this only happens on genuine API
 * failures (rare) and the overshoot is at most `cost` (1) energy for the
 * rest of that one day, that's an acceptable, deliberately unoptimized
 * trade against adding another transaction to a failure path.
 */
export async function refundEnergy(userId, action) {
  if (!isEnergySystemEnabled()) return;
  const cost = ACTION_ENERGY_COST[action];
  if (!cost) return;
  await prisma.userEnergy.updateMany({ where: { userId }, data: { energy: { increment: cost } } });
}

/**
 * "Recharge": grants +RECHARGE_ENERGY_AMOUNT energy immediately and logs a
 * RechargePurchase row - the same amount for every tier (see that
 * constant's comment). Fake today, consistent with the rest of this system:
 * no real Stripe charge happens, this just records what would have been
 * charged (see prisma/schema.prisma's RechargePurchase model and this
 * file's header TODO-equivalent - the real version would sit here, behind
 * a successful stripe.paymentIntents charge instead of running
 * unconditionally).
 *
 * A plain increment, same as refundEnergy - deliberately NOT re-clamped to
 * any ceiling, since stacking above the daily ceiling is the entire point.
 * No-ops (grants nothing, logs nothing) when the system is disabled, same
 * as every other function here - there's no ceiling to top up against, and
 * in practice this is only ever reachable from the blocked-energy
 * notification, which never fires when the system is off.
 */
export async function purchaseRecharge(userId, tier) {
  if (!isEnergySystemEnabled()) return { energyAdded: 0 };

  await ensureUserEnergy(userId, tier);
  await prisma.userEnergy.update({
    where: { userId },
    data: { energy: { increment: RECHARGE_ENERGY_AMOUNT } },
  });
  await prisma.rechargePurchase.create({
    data: { userId, energyAmount: RECHARGE_ENERGY_AMOUNT, priceUsd: RECHARGE_PRICE_USD, tier },
  });

  return { energyAdded: RECHARGE_ENERGY_AMOUNT };
}

/**
 * The taste-profile-analysis debounce: at most one real analysis per
 * rolling 24h per user, regardless of how many ratings come in. Called only
 * from lib/profile.js maybeAnalyzePreferences (the implicit, rating-driven
 * trigger) - the explicit "Ask AI to re-analyze" button and the chatbot's
 * reanalyze_preferences tool intentionally bypass this (see that file's
 * comment) since a user who just clicked "re-analyze" is owed an actual
 * re-analysis, not a silent no-op.
 *
 * Same atomic-conditional-update shape as the spend check: the `where`
 * clause (null or older than 24h) only matches if still true at the moment
 * this runs, so two concurrent rating saves can't both claim the slot.
 * Never blocks the caller with an error or a notification - a debounced
 * call just returns false and the caller silently skips analysis this time.
 */
export async function tryClaimProfileAnalysisSlot(userId) {
  if (!isEnergySystemEnabled()) return true;

  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const result = await prisma.userEnergy.updateMany({
    where: { userId, OR: [{ lastProfileAnalysisAt: null }, { lastProfileAnalysisAt: { lt: cutoff } } ] },
    data: { lastProfileAnalysisAt: new Date() },
  });
  return result.count > 0;
}

/**
 * Logs a real taste-profile-analysis execution to EnergyLog for cost
 * visibility (admin metrics) - called from lib/profile.js analyzePreferences
 * itself (the single chokepoint every trigger, explicit or implicit, funnels
 * through), right alongside that function's existing dollar-cost tracking.
 * Always blocked:false - this action can never be blocked by this system.
 * A no-op when the row doesn't exist (e.g. system disabled and the row was
 * never lazily created) rather than throwing, since this is pure logging.
 */
export async function logTasteProfileAnalysis(userId) {
  if (!isEnergySystemEnabled()) return;
  await prisma.energyLog.create({
    data: { userId, action: "taste_profile_analysis", cost: 1, blocked: false },
  });
}

/**
 * One-time correction for accounts whose UserEnergy.energy predates a
 * ceiling being lowered (FREE_DAILY_ENERGY was tightened from 6 to 4 - see
 * that constant's comment). refillIfStale deliberately never decreases
 * energy, specifically so it can't accidentally wipe out a legitimate
 * Recharge surplus (see that function's comment) - but that also means a
 * balance banked back when the ceiling was 6 just sits at 6 forever,
 * instead of ever settling down to the new, lower number, even though
 * every page now advertises the new ceiling.
 *
 * Corrects only what an account could never legitimately have: caps
 * `energy` at `ceiling + everything that user has ever bought via
 * Recharge` (which does legitimately stack above the ceiling and never
 * expires - see purchaseRecharge), so a real Recharge surplus is left
 * untouched and only the stale leftover from an old, higher ceiling gets
 * clamped down. Safe to run repeatedly, or against an already-correct
 * database - both are a no-op.
 *
 * Triggered from the "Energy system" card on /admin/metrics - see
 * app/api/admin/backfill-energy-ceiling/route.js. Not run automatically
 * on every request (same reasoning as backfillMissingPosters in
 * lib/titles.js): a rare, one-off correction doesn't belong on a hot path.
 */
export async function backfillStaleEnergyCeilings() {
  const rows = await prisma.userEnergy.findMany({
    select: { userId: true, energy: true, user: { select: { tier: true } } },
  });
  const rechargeTotals = await prisma.rechargePurchase.groupBy({
    by: ["userId"],
    _sum: { energyAmount: true },
  });
  const rechargeByUser = Object.fromEntries(rechargeTotals.map((r) => [r.userId, r._sum.energyAmount || 0]));

  let corrected = 0;
  for (const row of rows) {
    const correctMax = getEnergyCeiling(row.user.tier) + (rechargeByUser[row.userId] || 0);
    if (row.energy > correctMax) {
      await prisma.userEnergy.update({ where: { userId: row.userId }, data: { energy: correctMax } });
      corrected += 1;
    }
  }
  return { checked: rows.length, corrected };
}

// The exact 429 body shape every metered route returns - built here once so
// the three call sites (app/api/recommendations/route.js, .../surprise/
// route.js, app/api/chat/route.js) can't drift from each other. Framework-
// agnostic on purpose (plain object, not a NextResponse) - each route wraps
// it with `NextResponse.json(buildEnergyLimitBody(result), { status: 429 })`.
export function buildEnergyLimitBody(result) {
  return {
    error: "ENERGY_LIMIT_REACHED",
    tier: result.tier,
    action: result.action,
    energyRemaining: result.energyRemaining,
    resetAt: result.resetAt,
    ceiling: result.ceiling,
  };
}
