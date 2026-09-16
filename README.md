# CineMatch

CineMatch is a movie & TV show recommendation platform. Users rate what they've
watched, an AI engine turns that into a structured taste profile, and the app
recommends new titles they haven't seen — with a plain-English reason for
each pick. This repo is the **Phase 1 MVP**: a working, runnable version of
the full core loop, built to be extended.

> **If you're an AI assistant (e.g. Claude Code) picking this up**: read this
> whole file before changing anything. It explains the product concept, the
> architecture, and — importantly — what's intentionally simplified for the
> MVP vs. what's an actual bug. There's no other design doc in this repo to
> fall back on, so treat this README as the source of truth for *why* the
> code looks the way it does.

---

## 1. The idea, in plain language

A user rates movies/TV shows they've watched (and can say *why* they liked or
disliked them). An AI reads all of that and builds a **preference profile**:
favorite genres, recurring themes, storytelling preferences, streaming
services, taste nuances ("likes horror only when it's psychological, not
gory"), favorite directors/creators/actors, viewing-habit patterns
(runtime/length comfort, quality-bar leaning, era preference, content-rating
comfort, ongoing-vs-ended show preference), etc. That profile powers two things:

1. A **Recommendations page** — a queue of brand-new AI picks the user
   hasn't decided on yet, each with streaming availability, Rotten
   Tomatoes/IMDb scores, and a personalized "why you'll like it," plus a
   one-off "Surprise Me" pick that deliberately steps outside the user's
   usual taste while still being grounded in a real connecting thread.
2. A **Chatbot** — a conversational alternative to the rest of the app, not
   just a narrower add-on: log an opinion ("I just watched Andor and loved
   it"), add or check the Wishlist, ask for a recommendation on the spot
   ("something sad for tonight"), or ask it to review/edit/re-analyze your
   taste profile directly.

The user can also open **My Preferences**, a page that shows the AI's entire
profile of them in an editable form (chips, lists, a confidence dot per
genre) — inspired by Instagram's "Your Algorithm" page. Editing something
there is treated exactly like submitting a new rating: it reshapes future
recommendations immediately.

Marking a title "Not Interested" — on the Recommendations or Wishlist page —
prompts for an optional reason first. That's treated as just as strong a
signal as a 1-star rating: a deliberate rejection, not just silence.

This is the **core loop**: rate → AI analyzes → recommend → watch → rate
again. Every page in this app exists to feed or read from that loop.

## 2. The seven pages

| Page | Route | What it does |
|---|---|---|
| Home | `/home` | Entry point. A "welcome back" hero with progress toward a solid taste profile (rated titles vs. `RECOMMENDED_RATINGS_GOAL`, 10), quick-action links to every other page, and a preview of the user's **Wishlist** (titles they've actually decided they want to watch — a truer "coming up for you" than an undecided AI suggestion). |
| Ratings | `/ratings` | For titles the user has **already watched, in real life**: search (backed by TMDB, with an opt-in "show other possible matches" step for ambiguous titles) + a 1-5 star rating + optional "why." A small, dismissible reminder banner surfaces the 3 guided questions from `lib/questions.js` (favorites, recently watched, hated - trimmed down from an original 10, see that file's comment for why) as search inspiration — it's just a hint, not a form; there's no separate onboarding Q&A flow anymore. |
| Watched | `/watched` | Every title the user has rated as watched, editable in place (change the stars or the "why" and it re-saves). |
| Wishlist | `/wishlist` | Titles the user wants to watch but hasn't yet — searchable/addable directly here, or added via "Add to Wishlist" from a Recommendations card. Each entry can be marked Watched or Not Interested. |
| Recommendations | `/recommendations` | Gated behind `RATINGS_GOAL` (5) watched ratings — not enough signal to be more than a generic guess before that — with `RECOMMENDED_RATINGS_GOAL` (10) surfaced as a non-blocking "you'll get better picks" nudge past the unlock. Once unlocked: the queue of pending AI picks awaiting a decision, "Generate more picks" (a batch of up to 4 new suggestions - 2 movies + 2 TV shows, capped in code even if Claude returns more) and "Surprise Me" (exactly one deliberate stretch pick). A candidate that's already been rated or recommended is rejected in code before it's ever shown, regardless of what the prompt told Claude to avoid. Mark Watched immediately prompts for a star rating (`RateModal`) instead of leaving it to be rated later. Mark Watched / Add to Wishlist / Not Interested triages a card and closes the loop back into Ratings/Wishlist. Asks for the user's region on first use, since streaming availability is country-specific. |
| My Preferences | `/preferences` | The AI's profile of the user, fully readable and editable, including favorite genres, themes, storytelling notes, favorite creators/actors, and viewing-habit patterns. |
| Chatbot | `/chat` | Conversational interface with real read/write access to the same data every other page uses, via 5 tools (see `lib/chat.js`): log a rating/wishlist-add/not-interested (`log_title_opinion`), recommend a title (`recommend_title`, same dedup guard as the Recommendations page), view the Wishlist/Watched/Recommendations lists (`view_list`), re-run the full profile analysis on demand (`reanalyze_preferences`), and make a targeted edit to one profile field (`edit_preferences`). It's a genuine alternate way to drive the whole app, not a narrower chat-only experience. |

Ratings, Watched, and Wishlist used to be one combined page in an earlier
version of this MVP; they're now split so "log something I watched,"
"review what I've rated," and "manage what I want to watch" each have a
focused, uncluttered page.

## 3. Why the tech choices are what they are

This stack was chosen specifically to make `npm install && npm run dev` work
immediately, with no external services to configure, while staying easy for
an AI coding assistant to extend later.

- **Next.js 14 (App Router), plain JavaScript, no TypeScript.** One project,
  one dev server, for both frontend and backend (API routes live in
  `app/api/**/route.js`). No separate backend process to run. Plain JS (not
  TS) keeps every file readable top-to-bottom without type-annotation noise —
  feel free to introduce TypeScript later if you want stronger guarantees,
  but it wasn't necessary for an MVP this size.
- **SQLite via Prisma, not PostgreSQL.** Zero setup — the whole database is
  one file (`prisma/dev.db`). The original planning doc called for
  PostgreSQL for a real deployment; switching is a one-line change to
  `prisma/schema.prisma`'s `provider` plus a real `DATABASE_URL` (see
  Prisma's docs) since the schema itself doesn't use any SQLite-only
  features. **Caveat:** SQLite has no native array/JSON/enum column types, so
  several fields are stored as JSON-encoded strings instead (documented with
  comments in `schema.prisma` and handled by serialize/deserialize helpers in
  `lib/profile.js` and `lib/titles.js`). If you migrate to Postgres, you
  could convert those to real `Json`/array columns and simplify those helpers.
- **Hand-rolled auth (`lib/auth.js`), not NextAuth.js.** Password hashing
  (Node's built-in `crypto.scrypt`) and signed session cookies, with zero
  extra dependencies and every step visible in ~80 lines. This was a
  deliberate MVP simplification — **the plan doc calls for email/password +
  optional Google/Apple sign-in**, and Google/Apple weren't included yet
  specifically so the MVP needs zero external OAuth credentials to run. If
  you add OAuth, swapping this out for NextAuth.js (Auth.js) is the
  recommended path — see "What's not built yet" below.
- **TMDB + OMDb for title metadata**, not an AI lookup. This used to be an AI
  web-search call per uncached title (per the original planning doc's "AI web
  search instead of public APIs" decision) - reversed once it turned out to
  be both the app's biggest cost driver and its biggest source of latency (a
  multi-round-trip agentic search per title, on every cache miss). TMDB
  (free, `TMDB_API_KEY`) now covers name/genres/cast/overview/streaming
  availability in one fast structured call; OMDb (free, optional,
  `OMDB_API_KEY`) covers the one thing TMDB doesn't - RT/IMDb scores, keyed
  by the IMDb id TMDB provides. See `lib/titles.js`. Streaming availability
  is looked up per the user's region (`User.location`) when known, resolved
  to an ISO country code via a small lookup table, since TMDB's watch/
  providers endpoint is region-keyed.
- **Two-tier title search, opt-in disambiguation.** A search always resolves
  to TMDB's single best-ranked match (`findOrLookupTitle`, cached in
  `Title`). If that's the wrong title, the user can click "Show other
  possible matches" (`SearchRefineHint` component) to trigger a second,
  separate TMDB search (`findTitleCandidates`) that returns up to 4 real
  candidates to choose from instead. This is deliberately a second call the
  user has to ask for, not something that runs by default - both calls are
  cheap now (plain TMDB API calls, no LLM involved), but keeping the split
  still means the common case (search resolves correctly on the first try)
  stays a single request.
  **"Not found" is handled differently depending on which one comes back
  empty**, worth knowing since it's not obviously symmetric: if
  `findOrLookupTitle` gets zero TMDB results at all, `/api/titles/search`
  returns a 404 and the page just shows an error message - the "Show other
  possible matches" button isn't offered, since it only renders inside the
  "here's what we found" card, which never appears when nothing was found.
  So today, a genuine zero-result search is a dead end (retype with more
  detail) rather than a path into the candidate list - that only helps with
  "wrong match," not "no match." A candidate `findTitleCandidates` itself
  can't find just renders as "No other likely matches found." Elsewhere, a
  not-found result is handled per-caller: `generateRecommendations` silently
  drops that one candidate from the batch (so a "Generate more picks" click
  can come back with fewer than 4, for this reason as well as too-thin a
  profile - the toast doesn't currently distinguish the two), `generateSurprisePick`
  fails the whole action (there's only one pick to give), and the chatbot's
  tools return an error string that Claude relays conversationally.
- **One Claude model for everything, on purpose.** `CLAUDE_PROFILE_MODEL`
  (defaults to `claude-sonnet-5`) powers preference-profile synthesis
  (`lib/profile.js`), recommendation/Surprise Me candidate generation
  (`lib/recommendations.js`), and the chatbot (`lib/chat.js`). There used to
  be a second, cheaper tier (Haiku) for chat and recommendations, with Sonnet
  reserved for profile synthesis only — removed after a head-to-head test
  (identical scenarios run against both models, every claimed action checked
  against the actual database) caught Haiku occasionally claiming to have
  made a data edit it never actually made, once even fabricating a
  supporting detail to back up the false claim. That failure mode matters
  more than the cost/latency difference for a feature whose entire point is
  giving the user (and the chatbot, which now has real read/write access to
  ratings/wishlist/recommendations/preferences) trustworthy access to real
  data. Both the profile-synthesis and chatbot system prompts use Anthropic
  prompt caching (`cacheSystemPrompt` in `lib/anthropic.js` for the former,
  inline `cache_control` in `lib/chat.js` for the latter) — the
  recommendation prompts are fully static too but too short to clear
  Sonnet's 1024-token cache minimum, so caching them would be a no-op.

## 4. Project structure

```
cinematch/
  app/
    lp/[variant]/                              - marketing landing page (3 pitch variants, see below)
    login/, register/                          - auth pages
    home/, ratings/, watched/, wishlist/,
    recommendations/, preferences/, chat/       - the 7 main pages
    api/                                        - backend route handlers (one folder per resource)
    layout.js, page.js, globals.css             - page.js is "/" itself - renders the landing page (see below)
  components/
    NavBar.js                        - top nav across all 7 pages
    LandingPage.js                   - the marketing landing page's markup, shared by "/" and /lp/<variant>
    RatingsPageClient.js, WatchedPageClient.js, WishlistPageClient.js,
    RecommendationsPageClient.js, PreferencesPageClient.js, ChatPageClient.js
                                      - client-side logic for each page
    SearchRefineHint.js              - "show other possible matches" disambiguation UI
    NotInterestedModal.js            - shared "why not interested?" prompt (Recommendations + Wishlist)
    RateModal.js                     - shared "rate it now" prompt on Mark Watched (Recommendations + Wishlist)
    Toast.js                         - shared save/action confirmation toast
    StarRating.js, TitleMeta.js,
    TitlePoster.js                   - shared title-display building blocks (TitlePoster shows a real TMDB
                                        poster, falling back to a name-only card - see "What's already working")
  lib/
    prisma.js                        - shared Prisma Client instance
    auth.js, session.js              - password hashing, session tokens, "who's logged in"
    anthropic.js                     - thin Claude API wrapper (model selection, JSON parsing, prompt caching)
    titles.js                        - look up / cache movie & TV metadata via TMDB + OMDb, plus disambiguation candidates
    profile.js                       - the AI Preference Analysis Engine
    recommendations.js               - turns a profile into batch picks or a single "Surprise Me" pick
    chat.js                          - the chatbot's tool-use loop
    questions.js                     - the 3 guided questions + shared "enum" value lists
    landingVariants.js               - the 3 landing-page pitches + DEFAULT_LANDING_VARIANT (see below)
    useTitleSearch.js                - shared search/disambiguation hook (Ratings + Wishlist pages)
    useToast.js                      - shared toast-notification hook
  prisma/
    schema.prisma                    - database schema (see comments for SQLite-specific notes)
```

Every `lib/*.js` file has a comment at the top explaining its role — start
there if you're trying to understand how a feature works end to end.

## 5. Running it locally

**Prerequisites:** Node.js 18.18+ (Next.js 14's minimum), an
[Anthropic API key](https://console.anthropic.com/settings/keys), and a free
[TMDB API key](https://www.themoviedb.org/settings/api) (required - all title
lookups go through it). An [OMDb API key](https://www.omdbapi.com/apikey.aspx)
is optional (only powers RT/IMDb scores).

```bash
cd cinematch
npm install

cp .env.example .env
# then edit .env:
#   - set ANTHROPIC_API_KEY to a real key
#   - set TMDB_API_KEY to a real key (required - see .env.example)
#   - optionally set OMDB_API_KEY (RT/IMDb scores only - app works without it)
#   - set AUTH_SECRET to a random string, e.g. output of:
#     node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

npx prisma generate
npx prisma db push   # creates prisma/dev.db with the schema above

npm run dev
```

Open http://localhost:3000 — you'll see the marketing landing page (the
site's front door, testing one of 3 one-line pitches - see "Landing page &
pitch testing" below). Click "Get started free" to register, then try:

1. Go to Ratings and search for 2-3 titles you know well, rating each with
   a "why" (the reminder banner's sample questions are just inspiration if
   you're stuck on what to search).
2. Check `/preferences` — the AI should have populated at least genres and a
   summary based on what you just entered.
3. Go to `/recommendations` and click "Generate more picks" (or "Surprise
   Me" for one deliberate stretch pick) — you'll be asked for your region
   the first time, so streaming availability is accurate for your country.
4. Try `/chat` — tell it about a show you watched, or ask for a mood-based pick.
5. On any of the search-driven pages, try a deliberately ambiguous or
   misremembered title, then click "Show other possible matches" to see the
   disambiguation flow.

### Landing page & pitch testing

`/` shows a marketing landing page instead of going straight to login/
register - the idea being to catch a new visitor's attention with a pitch
first, the way most marketing sites do, rather than opening on a bare login
form. There are 3 one-line pitches to test against each other:

- **"AI picks your next watch."** (`/lp/ai-picks`) - capability-led
- **"Your taste, finally explained."** (`/lp/taste-explained`) - insight-led
- **"Stop wasting 5 days a year deciding what to watch."** (`/lp/decision-fatigue`) - pain-led

All 3 share one template (`components/LandingPage.js`) and stay live at their
own URL regardless of which one is the default, so you can point a specific
ad/campaign link at one exact pitch. Every "Get started" click carries which
pitch it came from through to the signup event (`landingVariant` in its
metadata - see `lib/events.js` and `app/api/register/route.js`), so
`/admin/metrics` can show views → signups → conversion per pitch, not just
which one got the most traffic.

**To change which pitch is the default** (the one shown at `/`): open
`lib/landingVariants.js` and change the `DEFAULT_LANDING_VARIANT` constant to
any key from `LANDING_VARIANTS` above it - nothing else needs to change,
anywhere. To add a 4th pitch: add a new entry to `LANDING_VARIANTS` (its own
headline/subhead), optionally point `DEFAULT_LANDING_VARIANT` at it - every
other file (the page template, the signup-attribution check, the metrics
page) reads from `LANDING_VARIANTS` directly, so a new key just works.

### A transparency note on testing

This project was originally scaffolded by an AI agent (Claude, via Cowork) in
a sandboxed environment without npm registry access, so early on its code was
verified by static means only (`node --check`, an esbuild syntax pass, manual
cross-checks) rather than a real run. That's no longer true - since then,
every feature in this README has been built and verified against a real
running `npm run dev` server (and, for anything touching real user data, real
throwaway or read-only test accounts), including a full page-by-page pass
right before the first production deploy. If you're picking this repo up
fresh, `npm run dev` should just work; the note below is kept for any
genuinely new addition that hasn't been through that process yet.

**If something breaks**, the most likely spots are:

- `TMDB_API_KEY` missing or invalid — title lookups/search will fail
  entirely (`lib/titles.js` throws a clear error naming the missing key).
  Get a free one at https://www.themoviedb.org/settings/api.
- `OMDB_API_KEY` missing or its 1,000-requests/day free-tier limit hit —
  degrades gracefully (RT/IMDb scores just come back null), doesn't break
  lookups.
- The default model string (`claude-sonnet-5` in `.env.example` /
  `CLAUDE_PROFILE_MODEL`) — swap it for whatever current Claude model you
  have access to if it's rejected.
- Anthropic SDK version drift — `package.json` pins `@anthropic-ai/sdk` to
  `"latest"` on purpose (this is a fast-moving package), so double check the
  installed version's API still matches how `lib/anthropic.js` and
  `lib/chat.js` call `client.messages.create(...)`.

## 6. Deploying to production

This app's database is SQLite - a single file on disk (`prisma/dev.db`
locally). That's zero-setup for development, but it means **serverless hosts
with an ephemeral/read-only filesystem (Vercel, in particular) won't work
without first migrating to a real hosted database** - see Path B below. The
simplest path to a live deploy keeps SQLite exactly as-is, on a host with a
real persistent disk and a long-running Node process.

### Path A: keep SQLite as-is (Railway, Render, or Fly.io)

1. Push this repo to GitHub: `git remote add origin <your-repo-url> && git push -u origin main`.
2. On [railway.app](https://railway.app), create a new project → "Deploy from GitHub repo" → select this repo. It auto-detects Next.js (via Nixpacks) and uses `npm run build` / `npm run start`.
3. Add a **Volume** and mount it somewhere like `/data` - this is what makes the SQLite file survive redeploys and restarts. Without it, every new deploy gets a fresh, empty filesystem and you'd lose all data.
4. Set environment variables (see `.env.example` for the full list) in the dashboard:
   - `ANTHROPIC_API_KEY` - your real key.
   - `TMDB_API_KEY` - your real key (title lookups won't work without it).
   - `OMDB_API_KEY` - your real key (optional - only RT/IMDb scores depend on it).
   - `AUTH_SECRET` - a **fresh** random value, never the one in your local `.env` (generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`).
   - `CLAUDE_PROFILE_MODEL` - same as local, or your preferred model.
   - `ADMIN_EMAILS` - whichever account(s) should see `/admin/metrics`.
   - `DATABASE_URL` - pointed at the volume, e.g. `file:/data/dev.db` (must match wherever you mounted the volume in step 3).
5. Run `npx prisma db push` once against the deployed environment to create the schema on that fresh database file (Railway's CLI supports running one-off commands against a deployed service - `railway run npx prisma db push` after `railway login` and `railway link`).
6. Visit the domain Railway assigns (or attach a custom domain).

Render and Fly.io follow the same shape: persistent disk + the same env vars
+ a one-time `prisma db push` against the deployed database.

### Path B: migrate to Postgres, then deploy anywhere (including Vercel)

A bigger lift, but the more scalable long-term path. `prisma/schema.prisma`'s
`datasource` block is a one-line `provider` change from `"sqlite"` to
`"postgresql"` (the schema itself uses no SQLite-only features); point
`DATABASE_URL` at a hosted Postgres instance (Neon, Supabase, and Vercel
Postgres all have free tiers), run `npx prisma db push` once to create the
schema there, then deploy normally - no volume needed, since the database
isn't local to the app server anymore.

## 7. What's already working (Phase 1 scope)

- Email/password auth (register, login, logout)
- Home page: progress toward a solid taste profile (two-tier goal - see
  below), quick-action links, and a Wishlist preview
- Ratings page: search (TMDB, cached, with opt-in disambiguation), rate a
  watched title, recently-rated summary, dismissible guided-questions
  reminder banner (3 sample prompts from `lib/questions.js`, for
  inspiration only — not a Q&A form)
- Watched page: every watched title, editable in place; anything marked
  watched without a star rating (e.g. a one-click "Mark Watched" from
  Wishlist/Recommendations, before the `RateModal` prompt below existed for
  those flows) is flagged with a visible "not yet rated" banner
- Wishlist page: search-and-add, or add from a Recommendations card; mark
  Watched or Not Interested from here too
- **Two-tier ratings goal**, not a single hard cutoff: `RATINGS_GOAL` (5)
  unlocks Recommendations/Surprise Me at all (below that, there's not enough
  signal for the AI to do more than guess generically); `RECOMMENDED_RATINGS_GOAL`
  (10) is a non-blocking "you'll get noticeably better picks" nudge shown
  past the unlock, never a gate. Messaging about "the more you rate (and the
  more detail in your 'why'), the better it gets" is reinforced consistently
  across Home, Ratings, Watched, Wishlist, and Recommendations.
- Recommendations page: batch "Generate more picks" (capped in code at the
  requested movie/TV count even if Claude returns more) + one-off "Surprise
  Me" stretch pick (retries once if its pick collides with something already
  known), region prompt for accurate streaming availability, Mark Watched
  (which now opens `RateModal` to capture a star rating in the moment,
  skippable) / Add to Wishlist / Not Interested triage
- **Already-known titles can't be re-recommended** - enforced in code (a
  resolved candidate's real database id is checked against everything the
  user has already rated or been recommended), not left to the prompt alone.
  Applies to the batch generator, Surprise Me, and the chatbot's
  `recommend_title` tool alike.
- Shared "Not Interested" reason prompt (Recommendations + Wishlist) —
  captured as a strong negative signal, on par with a 1-star rating
- Title cards show a real poster image (`TitlePoster.js`, from TMDB's
  `poster_path`), falling back to a name-only card when there isn't one or
  it fails to load. This used to be name-only unconditionally: an earlier
  AI-web-search-based lookup fabricated plausible-looking poster URLs that
  mostly 404'd (verified against real data: only ~1 of 66 cached titles ever
  had one that actually loaded), so posters were dropped app-wide rather
  than show a broken image most of the time. TMDB's `poster_path` is a real,
  verified field in the same response already fetched for genres/cast/etc -
  not a guess - so this is reliable now (verified live: a fresh lookup's
  poster URL actually loads a real image). Any `Title` row cached before
  this changed only picks up a poster on its next natural 30-day refresh
  unless backfilled - see `backfillMissingPosters` in `lib/titles.js` and
  the one-off "Backfill posters" button on `/admin/metrics`.
- AI Preference Analysis Engine: builds/updates a profile from a user's
  **entire** rating history (no cap - a title's genres and a short plot
  synopsis are part of that signal now too, alongside stars/why/runtime/
  quality scores/content rating/director/cast), treats the existing profile
  as a starting point rather than overwriting it wholesale. Runs immediately
  on a user's very first rating, then batched to roughly every 3rd
  rating/triage after that (a real cost saver once title lookups stopped
  being the expensive part - see Section 3); deleting a rating and the
  manual "Ask AI to re-analyze" button always run it immediately instead,
  since those are explicit, infrequent user actions that deserve an
  up-to-date answer, not a batched one.
- My Preferences page: full read + edit of the profile, "Ask AI to
  re-analyze" button
- Chatbot: genuine read/write access to the same data every other page
  uses (see the pages table above for the 5 tools), not just logging
  opinions - grounded in the user's current profile every turn, with an
  explicit system-prompt instruction never to claim an action succeeded
  without actually having called its tool that turn (a real failure mode
  found in testing - see Section 3)
- Single-model architecture (`CLAUDE_PROFILE_MODEL`, defaults to
  `claude-sonnet-5`) used for every remaining Claude call in the app
  (profile synthesis, recommendations, chat) - see Section 3 for why a
  cheaper second tier was tried and removed. Title metadata isn't an
  LLM call at all anymore (TMDB/OMDb). Prompt caching is used on both the
  profile-synthesis and chatbot system prompts.
- Mobile-friendly responsive layout (nav collapses to a menu, poster+detail
  rows stack, tables scroll horizontally instead of overflowing) across
  every page
- Privacy Policy and Terms of Service pages with real operator/contact
  details, not placeholder text
- Big, clear confirmation toasts (`Toast.js` / `useToast.js`) after every
  save-worthy action (rating saved, preferences updated, recommendation
  triaged, etc.), each with a short line of guidance on where to find the
  result (e.g. "You can see it on the Watched page.")

## 8. What's not built yet (intentionally — see the planning doc's roadmap)

These are Phase 2/3 items from the original plan, not oversights:

- **Google/Apple sign-in.** Only email/password exists right now (see
  Section 3 above for why, and the suggested NextAuth.js migration path).
- **Background cache-refresh job.** `lib/titles.js` re-searches the web for a
  title after 30 days (`CACHE_TTL_DAYS`), but only lazily, on next lookup —
  there's no scheduled job proactively refreshing stale streaming
  availability.
- **Recommendation diversity guardrails.** The prompt in
  `lib/recommendations.js` asks Claude to diversify beyond the user's
  dominant genre, but there's no code-level enforcement of that (unlike
  de-duplication, which *is* enforced in code now - see Section 7).
- **Visual design pass.** Styling (`app/globals.css`) is intentionally plain
  and functional, matching the wireframe layouts from the planning doc, not
  a finished visual design - though it is responsive/mobile-friendly (see
  Section 7), which is a layout concern, not a visual-polish one.
- **Notifications/nudges**, e.g. "a new episode of a show you love is out."
- **Demographics-aware recommending** — the field exists (My Preferences page,
  `User.location`, `PreferenceProfile.demographicsConsider`) and is included
  in the prompt context, but there's no dedicated logic weighting a title's
  country of origin against it yet.

## 9. A note on data & privacy

Everything lives in your local SQLite file (`prisma/dev.db`, git-ignored).
The external calls this app makes are: the Anthropic API (profile synthesis,
recommendations, chat), TMDB and OMDb (title metadata - see Section 3).
There's no analytics, tracking, or other third-party service beyond that.
The Privacy Policy page (`/privacy`) reflects this.
