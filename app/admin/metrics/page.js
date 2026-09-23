// Internal metrics page - the activation funnel (signup -> first rating ->
// 10 watched ratings) plus a live feed of recent milestone events. Gated by
// ADMIN_EMAILS (see lib/admin.js), not linked from anywhere in the app's
// nav - reach it by URL. See lib/events.js for what writes the Event rows
// this page reads from.
//
// The funnel numbers below are computed live from the User/Rating tables,
// NOT from the Event log - event tracking only started recording milestones
// going forward (see lib/events.js), so any account that already had 10+
// watched ratings before that shipped would never get a retroactive
// activated_10_watched row. Computing the funnel from current data instead
// means it's accurate for every account, old or new. The Event log is used
// below for what it's actually good for: a real-time feed of new milestones
// and (for accounts that activate from here on) time-to-activation.

import { requireUser } from "@/lib/session";
import { isAdmin } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { EVENT_NAMES } from "@/lib/events";
import NavBar from "@/components/NavBar";
import AdminPosterBackfillButton from "@/components/AdminPosterBackfillButton";

const EVENT_LABELS = {
  [EVENT_NAMES.SIGNUP]: "Signed up",
  [EVENT_NAMES.FIRST_RATING]: "First rating",
  [EVENT_NAMES.ACTIVATED_10_WATCHED]: "Activated (10 watched)",
  [EVENT_NAMES.ACTIVE_DAY]: "Active day",
  [EVENT_NAMES.PAGE_VIEW]: "Page view",
  [EVENT_NAMES.SEARCH_PERFORMED]: "Search performed",
  [EVENT_NAMES.SHOW_OTHER_MATCHES_USED]: "Show other matches used",
  [EVENT_NAMES.RATING_SAVED]: "Rating saved",
  [EVENT_NAMES.RATING_DELETED]: "Rating deleted",
  [EVENT_NAMES.RECOMMENDATIONS_GENERATED]: "Generated recommendations",
  [EVENT_NAMES.SURPRISE_PICK_GENERATED]: "Surprise pick generated",
  [EVENT_NAMES.RECOMMENDATION_TRIAGED]: "Recommendation triaged",
  [EVENT_NAMES.CHAT_MESSAGE_SENT]: "Chat message sent",
  [EVENT_NAMES.CHAT_CLEARED]: "Chat cleared",
  [EVENT_NAMES.PROFILE_EDITED]: "Profile edited",
  [EVENT_NAMES.PROFILE_REANALYZED]: "Profile re-analyzed",
  [EVENT_NAMES.LANDING_VIEW]: "Landing page view",
  [EVENT_NAMES.COST_PROFILE_ANALYSIS]: "Cost: profile analysis",
  [EVENT_NAMES.COST_RECOMMENDATIONS_BATCH]: "Cost: recommendation batch",
  [EVENT_NAMES.COST_SURPRISE_PICK]: "Cost: surprise pick",
  [EVENT_NAMES.COST_CHAT_MESSAGE]: "Cost: chat message",
};

// The four cost-tracking events (see lib/events.js trackCostEvent) - each
// row here becomes one row of the "AI cost" card below. Order matters: this
// is the display order.
const COST_EVENT_ROWS = [
  { name: EVENT_NAMES.COST_PROFILE_ANALYSIS, label: "Taste-profile analysis", note: "fires after most ratings, batched - see lib/profile.js" },
  { name: EVENT_NAMES.COST_RECOMMENDATIONS_BATCH, label: "Recommendation batch (4 picks)", note: "\"Generate more picks\"" },
  { name: EVENT_NAMES.COST_SURPRISE_PICK, label: "Surprise Me pick (1 pick)", note: "includes any retry on a collision" },
  { name: EVENT_NAMES.COST_CHAT_MESSAGE, label: "Chat message", note: "summed across that turn's full tool-use loop" },
];

// Feature-usage events shown in the "Feature usage" card below - everything
// except the funnel milestones (signup/first_rating/activated_10_watched,
// shown in their own card) and the page_view/active_day pair (page_view gets
// its own per-page breakdown; active_day only powers the Active users card).
const FEATURE_EVENT_NAMES = [
  EVENT_NAMES.SEARCH_PERFORMED,
  EVENT_NAMES.SHOW_OTHER_MATCHES_USED,
  EVENT_NAMES.RATING_SAVED,
  EVENT_NAMES.RATING_DELETED,
  EVENT_NAMES.RECOMMENDATIONS_GENERATED,
  EVENT_NAMES.SURPRISE_PICK_GENERATED,
  EVENT_NAMES.RECOMMENDATION_TRIAGED,
  EVENT_NAMES.CHAT_MESSAGE_SENT,
  EVENT_NAMES.CHAT_CLEARED,
  EVENT_NAMES.PROFILE_EDITED,
  EVENT_NAMES.PROFILE_REANALYZED,
];

const PAGE_LABELS = {
  home: "Home",
  ratings: "Ratings",
  watched: "Watched",
  wishlist: "Wishlist",
  recommendations: "Recommendations",
  preferences: "My Preferences",
  chat: "Chat",
};

function pct(part, total) {
  if (!total) return "0%";
  return `${((part / total) * 100).toFixed(1)}%`;
}

// Small values (a single call is usually a fraction of a cent) need more
// decimal places than a running total does, or they'd all just show "$0.00".
function formatUsd(amount) {
  if (!amount) return "$0.00";
  return amount < 0.01 ? `$${amount.toFixed(4)}` : `$${amount.toFixed(2)}`;
}

function formatTokens(n) {
  return n.toLocaleString("en-US");
}

function formatMetadata(metadata) {
  if (!metadata) return "-";
  try {
    const parsed = JSON.parse(metadata);
    return Object.entries(parsed)
      .map(([k, v]) => `${k}: ${v}`)
      .join(", ");
  } catch {
    return metadata;
  }
}

export default async function AdminMetricsPage() {
  const user = await requireUser();

  if (!isAdmin(user)) {
    return (
      <>
        <NavBar activePath="/admin/metrics" />
        <div className="page">
          <h1>Not authorized</h1>
          <p className="muted">This page is only visible to admins.</p>
        </div>
      </>
    );
  }

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const costEventNames = COST_EVENT_ROWS.map((r) => r.name);
  // page_view/active_day/landing_view/cost_* are excluded here - they'd
  // flood out everything else in a "last 30" feed (they all have their own
  // cards - see the Page views, Landing page conversion, and AI cost cards).
  const excludedFromFeed = [EVENT_NAMES.PAGE_VIEW, EVENT_NAMES.ACTIVE_DAY, EVENT_NAMES.LANDING_VIEW, ...costEventNames];

  const [
    totalUsers,
    watchedCounts,
    recentEvents,
    signupEvents,
    activatedEvents,
    activeTodayGroups,
    activeLast7Groups,
    pageViewEvents,
    featureEventCounts,
    landingViewCount,
    costEvents,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.rating.groupBy({ by: ["userId"], where: { status: "watched" }, _count: { _all: true } }),
    prisma.event.findMany({
      where: { name: { notIn: excludedFromFeed } },
      orderBy: { createdAt: "desc" },
      take: 30,
      include: { user: { select: { email: true } } },
    }),
    prisma.event.findMany({ where: { name: EVENT_NAMES.SIGNUP }, select: { userId: true, createdAt: true } }),
    prisma.event.findMany({
      where: { name: EVENT_NAMES.ACTIVATED_10_WATCHED },
      select: { userId: true, createdAt: true },
    }),
    prisma.event.groupBy({ by: ["userId"], where: { name: EVENT_NAMES.ACTIVE_DAY, createdAt: { gte: startOfToday } } }),
    prisma.event.groupBy({ by: ["userId"], where: { name: EVENT_NAMES.ACTIVE_DAY, createdAt: { gte: sevenDaysAgo } } }),
    prisma.event.findMany({ where: { name: EVENT_NAMES.PAGE_VIEW }, select: { metadata: true } }),
    prisma.event.groupBy({ by: ["name"], where: { name: { in: FEATURE_EVENT_NAMES } }, _count: { _all: true } }),
    prisma.event.count({ where: { name: EVENT_NAMES.LANDING_VIEW } }),
    // metadata is a JSON string, not a queryable column in SQLite, so the
    // actual sum/avg math happens in JS below rather than via groupBy/_sum.
    prisma.event.findMany({ where: { name: { in: costEventNames } }, select: { name: true, metadata: true } }),
  ]);

  // TEMPORARY diagnostic - added to check whether production's actual Title
  // rows have genres/overview populated (both are now used as AI Preference
  // Analysis Engine signal, see lib/profile.js), since that can't be
  // verified from outside the deployed container (SQLite lives on its
  // volume, not a networked DB - see the README's SQLite/deploy notes).
  // Remove this card once that's confirmed.
  const [totalTitles, titlesMissingOverview, titlesMissingGenres, titlesMissingPoster, oldestTitle] = await Promise.all([
    prisma.title.count(),
    prisma.title.count({ where: { overview: null } }),
    prisma.title.count({ where: { genres: "[]" } }),
    prisma.title.count({ where: { posterUrl: null } }),
    prisma.title.findFirst({ orderBy: { lastRefreshed: "asc" }, select: { name: true, lastRefreshed: true } }),
  ]);

  const ratedAtLeastOnce = watchedCounts.length;
  const activated = watchedCounts.filter((w) => w._count._all >= 10).length;
  const activeToday = activeTodayGroups.length;
  const activeLast7Days = activeLast7Groups.length;

  const pageViewCounts = {};
  for (const e of pageViewEvents) {
    try {
      const { page } = JSON.parse(e.metadata || "{}");
      if (page) pageViewCounts[page] = (pageViewCounts[page] || 0) + 1;
    } catch {
      // malformed metadata - skip rather than crash the whole page
    }
  }
  const pageViewRows = Object.entries(pageViewCounts).sort((a, b) => b[1] - a[1]);

  const featureCountsMap = Object.fromEntries(featureEventCounts.map((e) => [e.name, e._count._all]));

  // AI cost - each cost_* event's metadata carries token counts and a
  // precomputed costUsd (see lib/events.js trackCostEvent), so this is a
  // straight sum per event name rather than a re-derivation of the pricing
  // math (that lives once, in lib/anthropic.js computeCostUsd).
  const costStats = {};
  for (const row of COST_EVENT_ROWS) {
    costStats[row.name] = { calls: 0, tokens: 0, costUsd: 0 };
  }
  for (const e of costEvents) {
    try {
      const m = JSON.parse(e.metadata || "{}");
      const stat = costStats[e.name];
      if (!stat) continue;
      stat.calls += 1;
      stat.tokens += (m.inputTokens || 0) + (m.outputTokens || 0) + (m.cacheCreationTokens || 0) + (m.cacheReadTokens || 0);
      stat.costUsd += m.costUsd || 0;
    } catch {
      // malformed metadata - skip rather than crash the whole page
    }
  }
  const totalAiCostUsd = Object.values(costStats).reduce((sum, s) => sum + s.costUsd, 0);
  const totalAiCalls = Object.values(costStats).reduce((sum, s) => sum + s.calls, 0);

  // Time-to-activation: only computable for accounts that both signed up
  // AND activated after event tracking shipped (both events need to exist).
  const signupByUser = new Map(signupEvents.map((e) => [e.userId, e.createdAt]));
  const activationDaysList = activatedEvents
    .map((e) => {
      const signedUpAt = signupByUser.get(e.userId);
      if (!signedUpAt) return null;
      return (e.createdAt.getTime() - new Date(signedUpAt).getTime()) / (1000 * 60 * 60 * 24);
    })
    .filter((d) => d !== null);
  const avgDaysToActivate = activationDaysList.length
    ? activationDaysList.reduce((a, b) => a + b, 0) / activationDaysList.length
    : null;

  const earliestEvent = await prisma.event.findFirst({ orderBy: { createdAt: "asc" } });
  const trackingStartLabel = earliestEvent
    ? new Date(earliestEvent.createdAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
    : null;

  return (
    <>
      <NavBar activePath="/admin/metrics" />
      <div className="page">
        <h1>Internal Metrics</h1>
        <p className="muted" style={{ marginBottom: 24 }}>
          Visible only to admins. Not linked from anywhere in the app - bookmark this URL.
        </p>

        <div className="card">
          <h2>Activation funnel</h2>
          <p className="muted">
            Computed live from current data, so it&apos;s accurate even for accounts that existed before event
            tracking shipped{trackingStartLabel ? ` (${trackingStartLabel})` : ""}.
          </p>

          <div style={{ marginTop: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, marginBottom: 4 }}>
              <span>Signed up</span>
              <strong>{totalUsers}</strong>
            </div>
            <div className="progress-bar">
              <div className="progress-bar-fill" style={{ width: "100%" }} />
            </div>
          </div>

          <div style={{ marginTop: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, marginBottom: 4 }}>
              <span>Rated at least one title</span>
              <strong>
                {ratedAtLeastOnce} <span className="muted">({pct(ratedAtLeastOnce, totalUsers)} of signups)</span>
              </strong>
            </div>
            <div className="progress-bar">
              <div className="progress-bar-fill" style={{ width: pct(ratedAtLeastOnce, totalUsers) }} />
            </div>
          </div>

          <div style={{ marginTop: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, marginBottom: 4 }}>
              <span>Reached 10 watched ratings (activated)</span>
              <strong>
                {activated}{" "}
                <span className="muted">
                  ({pct(activated, totalUsers)} of signups, {pct(activated, ratedAtLeastOnce)} of raters)
                </span>
              </strong>
            </div>
            <div className="progress-bar">
              <div className="progress-bar-fill" style={{ width: pct(activated, totalUsers) }} />
            </div>
          </div>
        </div>

        <div className="card">
          <h2>Landing page conversion</h2>
          <p className="muted">
            Landing page views are a new metric, tracked only from when this shipped - unlike the funnel above,
            it can&apos;t be computed retroactively (there&apos;s no view to count for a signup that happened
            before tracking existed). Signups below are all-time, so this ratio will look inflated at first and
            settle toward a real number as more signups happen after view tracking began.
          </p>
          <div style={{ display: "flex", gap: 32, marginTop: 12, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 28, fontFamily: "var(--font-heading)", fontWeight: "var(--font-heading-weight)" }}>
                {landingViewCount}
              </div>
              <div className="muted">Landing page views</div>
            </div>
            <div>
              <div style={{ fontSize: 28, fontFamily: "var(--font-heading)", fontWeight: "var(--font-heading-weight)" }}>
                {totalUsers}
              </div>
              <div className="muted">Signed up (all-time)</div>
            </div>
            <div>
              <div style={{ fontSize: 28, fontFamily: "var(--font-heading)", fontWeight: "var(--font-heading-weight)" }}>
                {landingViewCount ? pct(totalUsers, landingViewCount) : "-"}
              </div>
              <div className="muted">View &rarr; signup rate</div>
            </div>
          </div>
        </div>

        <div className="card">
          <h2>Title data health (temporary)</h2>
          <p className="muted">
            One-off check on whether cached titles actually have genres/overview/posters populated in THIS
            database - remove this card once confirmed. See lib/profile.js for why genres/overview matter (AI
            Preference Analysis Engine signal) and lib/titles.js for the poster backfill button below (posters
            used to always be null - any title cached before that changed only gets one on its next natural
            30-day refresh, unless backfilled now).
          </p>
          <ul style={{ marginTop: 12 }}>
            <li>Total cached titles: <strong>{totalTitles}</strong></li>
            <li>
              Missing overview: <strong>{titlesMissingOverview}</strong>{" "}
              <span className="muted">({pct(titlesMissingOverview, totalTitles)})</span>
            </li>
            <li>
              Missing genres: <strong>{titlesMissingGenres}</strong>{" "}
              <span className="muted">({pct(titlesMissingGenres, totalTitles)})</span>
            </li>
            <li>
              Missing poster: <strong>{titlesMissingPoster}</strong>{" "}
              <span className="muted">({pct(titlesMissingPoster, totalTitles)})</span>
            </li>
            {oldestTitle && (
              <li>
                Oldest cached title: <strong>{oldestTitle.name}</strong>, last refreshed{" "}
                {new Date(oldestTitle.lastRefreshed).toLocaleDateString("en-US")}
              </li>
            )}
          </ul>
          <AdminPosterBackfillButton />
        </div>

        <div className="card">
          <h2>Active users</h2>
          <p className="muted">
            Distinct users who visited any page today, or in the last 7 days - the simple retention signal (based
            on the &quot;active_day&quot; event, first recorded {trackingStartLabel || "recently"}).
          </p>
          <div style={{ display: "flex", gap: 32, marginTop: 12 }}>
            <div>
              <div style={{ fontSize: 28, fontFamily: "var(--font-heading)", fontWeight: "var(--font-heading-weight)" }}>
                {activeToday}
              </div>
              <div className="muted">Active today</div>
            </div>
            <div>
              <div style={{ fontSize: 28, fontFamily: "var(--font-heading)", fontWeight: "var(--font-heading-weight)" }}>
                {activeLast7Days}
              </div>
              <div className="muted">Active in the last 7 days</div>
            </div>
          </div>
        </div>

        <div className="card">
          <h2>Time to activation</h2>
          {avgDaysToActivate !== null ? (
            <p>
              On average, users who activated since tracking began took{" "}
              <strong>{avgDaysToActivate.toFixed(1)} days</strong> from signup to reaching 10 watched ratings, based
              on {activationDaysList.length} user{activationDaysList.length === 1 ? "" : "s"}.
            </p>
          ) : (
            <p className="muted">
              Not enough data yet - this fills in once a user signs up and reaches 10 watched ratings after event
              tracking began{trackingStartLabel ? ` (${trackingStartLabel})` : ""}. Accounts that were already
              active before then aren&apos;t counted here, since we don&apos;t know exactly when they crossed 10.
            </p>
          )}
        </div>

        <div className="card">
          <h2>AI cost (tokens &amp; $)</h2>
          <p className="muted">
            What each Claude call actually costs, computed from real token usage on every call (see
            lib/anthropic.js computeCostUsd) - not an estimate. Sonnet 5 pricing: $2/$10 per million input/output
            tokens, with cache writes at 1.25x input and cache reads at 0.1x input.
          </p>
          <p style={{ marginTop: 12, marginBottom: 12 }}>
            Total AI spend so far: <strong>{formatUsd(totalAiCostUsd)}</strong>{" "}
            <span className="muted">across {totalAiCalls} call{totalAiCalls === 1 ? "" : "s"}</span>
          </p>
          {totalAiCalls === 0 ? (
            <p className="muted">No AI calls tracked yet.</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Feature</th>
                  <th>Calls</th>
                  <th>Total tokens</th>
                  <th>Total cost</th>
                  <th>Avg cost / call</th>
                </tr>
              </thead>
              <tbody>
                {COST_EVENT_ROWS.map((row) => {
                  const stat = costStats[row.name];
                  return (
                    <tr key={row.name}>
                      <td>
                        {row.label}
                        <br />
                        <span className="muted" style={{ fontSize: 11 }}>{row.note}</span>
                      </td>
                      <td>{stat.calls}</td>
                      <td>{formatTokens(stat.tokens)}</td>
                      <td>{formatUsd(stat.costUsd)}</td>
                      <td>{stat.calls ? formatUsd(stat.costUsd / stat.calls) : "-"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="two-col">
          <div className="card">
            <h2>Page views (all time)</h2>
            {pageViewRows.length === 0 ? (
              <p className="muted">No page views logged yet.</p>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Page</th>
                    <th>Views</th>
                  </tr>
                </thead>
                <tbody>
                  {pageViewRows.map(([page, count]) => (
                    <tr key={page}>
                      <td>{PAGE_LABELS[page] || page}</td>
                      <td>{count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="card">
            <h2>Feature usage (all time)</h2>
            {FEATURE_EVENT_NAMES.every((name) => !featureCountsMap[name]) ? (
              <p className="muted">No feature-usage events logged yet.</p>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Action</th>
                    <th>Count</th>
                  </tr>
                </thead>
                <tbody>
                  {FEATURE_EVENT_NAMES.map((name) => (
                    <tr key={name}>
                      <td>{EVENT_LABELS[name] || name}</td>
                      <td>{featureCountsMap[name] || 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="card">
          <h2>Recent activity</h2>
          <p className="muted">
            Live event log{trackingStartLabel ? ` - tracking began ${trackingStartLabel}` : ""} - the last 30
            milestones and feature-usage events (page views excluded; see the card above for those). The funnel
            above doesn&apos;t depend on this feed.
          </p>
          {recentEvents.length === 0 ? (
            <p className="muted">No events logged yet - they&apos;ll show up here as they happen.</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Event</th>
                  <th>User</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {recentEvents.map((e) => (
                  <tr key={e.id}>
                    <td>{new Date(e.createdAt).toLocaleString("en-US")}</td>
                    <td>{EVENT_LABELS[e.name] || e.name}</td>
                    <td>{e.user?.email || "-"}</td>
                    <td>{formatMetadata(e.metadata)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}
