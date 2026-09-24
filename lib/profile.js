// The "AI Preference Analysis Engine" from the planning doc (Section 4).
// This is the heart of the whole app: it reads a user's ratings and turns
// them into the structured profile shown on the My Preferences page, which
// in turn drives recommendations and the chatbot. The guided questions on
// the Ratings page (lib/questions.js GUIDED_QUESTIONS) are a reminder
// pop-up only - they're never collected or fed in here.

import { prisma } from "@/lib/prisma";
import { askClaudeForJSON, getProfileModel } from "@/lib/anthropic";
import { trackCostEvent, EVENT_NAMES } from "@/lib/events";
import { tryClaimProfileAnalysisSlot, logTasteProfileAnalysis } from "@/lib/energy";

// Fields on PreferenceProfile that are stored as JSON-encoded strings in
// SQLite (see prisma/schema.prisma) but should be plain JS arrays everywhere
// else in the app. Exported so other callers (e.g. lib/chat.js's
// edit_preferences tool) can validate against the same list instead of
// duplicating it.
export const ARRAY_FIELDS = [
  "generalLikes",
  "generalDislikes",
  "genres",
  "storytelling",
  "languages",
  "themes",
  "nuances",
  "favoriteCreators",
  "viewingHabits",
];

function deserializeProfile(row) {
  if (!row) return null;
  const out = { ...row };
  for (const field of ARRAY_FIELDS) {
    out[field] = JSON.parse(row[field] || "[]");
  }
  return out;
}

function serializeProfileFields(fields) {
  const out = {};
  for (const key of Object.keys(fields)) {
    out[key] = ARRAY_FIELDS.includes(key) ? JSON.stringify(fields[key]) : fields[key];
  }
  return out;
}

export async function getProfile(userId) {
  const row = await prisma.preferenceProfile.findUnique({ where: { userId } });
  return deserializeProfile(row);
}

// Used by the My Preferences page for manual edits (add/remove a chip,
// tweak a genre's confidence, rewrite a note, etc). Per the planning doc,
// a manual edit is treated exactly like a rating: it's saved immediately
// and reflected on the Recommendations page right away.
export async function updateProfile(userId, partialFields) {
  const data = serializeProfileFields(partialFields);
  const row = await prisma.preferenceProfile.upsert({
    where: { userId },
    update: data,
    create: { userId, ...data },
  });
  return deserializeProfile(row);
}

/**
 * Re-runs preference analysis for a user: gathers their ratings and asks
 * Claude to produce an updated structured profile. Called after every new
 * rating, after a chatbot exchange that reveals a preference, and on-demand
 * via the "Ask AI to re-analyze" button on the My Preferences page.
 */
export async function analyzePreferences(userId) {
  // Guided questions are a Ratings-page reminder pop-up only (see
  // components/RatingsPageClient.js) - they're never collected or stored, so
  // they have zero effect on the profile. Ratings are the only input here.
  //
  // No `take` cap - every rating is read. This used to stop at the most
  // recent 50, back when title lookups were an expensive AI web-search call
  // per title and every extra rating in this prompt meant more tokens spent
  // reasoning over data that was itself expensive to gather. Now that title
  // metadata comes from TMDB/OMDb (flat-rate API calls, not per-token LLM
  // cost - see lib/titles.js), the only remaining cost of a bigger history
  // here is this one Sonnet call's input tokens, which stays cheap even for
  // a few hundred ratings - and this call is already batched to roughly
  // every 3rd rating (see maybeAnalyzePreferences below), not run per-rating.
  // Losing a user's older ratings from analysis (the old cap's actual
  // effect once someone passed 50) was a real accuracy cost with no upside
  // left worth keeping.
  const [ratings, existingProfile] = await Promise.all([
    prisma.rating.findMany({
      where: { userId },
      include: { title: true },
      orderBy: { createdAt: "desc" },
    }),
    getProfile(userId),
  ]);

  // Not enough signal yet to bother calling the AI.
  if (ratings.length === 0) {
    return existingProfile;
  }

  const ratingsSummary = ratings
    .map((r) => {
      const t = r.title;
      const bits = [`"${t.name}"${t.year ? ` (${t.year})` : ""} - status: ${r.status}`];
      if (r.stars) bits.push(`${r.stars}/5 stars`);
      if (r.why) bits.push(`why: "${r.why}"`);

      // Genre/plot signal - previously missing entirely, which meant the
      // model had to already happen to know a title (from training data) to
      // have any idea what it was even about. Both are now free to include:
      // genres/overview already come back from the TMDB lookup that saved
      // this Title row (see lib/titles.js), no extra API or LLM call needed.
      const genres = JSON.parse(t.genres || "[]");
      if (genres.length) bits.push(`genres: ${genres.join("/")}`);
      if (t.overview) {
        const synopsis = t.overview.length > 160 ? `${t.overview.slice(0, 160).trim()}...` : t.overview;
        bits.push(`plot: "${synopsis}"`);
      }

      // Length/pacing signal: runtime for movies, season/episode shape for TV.
      if (t.type === "tv") {
        const tvBits = ["TV show"];
        if (t.seasons) tvBits.push(`${t.seasons} season${t.seasons === 1 ? "" : "s"}`);
        if (t.avgEpisodesPerSeason) tvBits.push(`~${t.avgEpisodesPerSeason} eps/season`);
        if (t.avgEpisodeRuntimeMinutes) tvBits.push(`~${t.avgEpisodeRuntimeMinutes}m/episode`);
        if (t.showStatus) tvBits.push(t.showStatus);
        bits.push(tvBits.join(" "));
      } else if (t.runtimeMinutes) {
        bits.push(`movie, ${t.runtimeMinutes}m runtime`);
      }

      // Quality-bar signal.
      if (t.rtScore != null) bits.push(`RT ${t.rtScore}%`);
      if (t.imdbScore != null) bits.push(`IMDb ${t.imdbScore}`);

      // Maturity/content-rating signal.
      if (t.contentRating) bits.push(`rated ${t.contentRating}`);

      // Director/creator/cast affinity signal.
      if (t.director) bits.push(`dir. ${t.director}`);
      if (t.creator) bits.push(`creator ${t.creator}`);
      const cast = JSON.parse(t.cast || "[]");
      if (cast.length) bits.push(`cast: ${cast.slice(0, 3).join(", ")}`);

      return `- ${bits.join(", ")}`;
    })
    .join("\n");

  const system = `You are the preference-analysis engine for a movie/TV recommendation platform.
Read a user's ratings and produce a structured taste profile as JSON.
Be specific and ground every claim in the ratings actually given - avoid generic, boilerplate genre statements.

If an existing profile is provided below, treat it as your starting point: keep anything that still looks right,
and only change fields where the new data justifies a change. Some fields may have been hand-edited by the user
themselves (you can't tell which), so be conservative about overwriting specific, detailed entries with vaguer ones.

TITLE NAMING - follow this exactly, it is a common mistake: whenever you mention a specific movie/TV title anywhere
in your output (summary, storytelling, themes, generalLikes, generalDislikes, nuances), use its correct official
title in its ORIGINAL production language, matching the exact spelling shown in the RATINGS list below - never a
typo, a plural, or a localized/dubbed/translated name a user's "why" text might have used. Example: "A Procura da
Felicidade" is the Portuguese release name for the American movie "The Pursuit of Happyness" - if RATINGS shows
"The Pursuit of Happyness", write that, not the translated name. A movie that genuinely is Brazilian/French/etc.
in its original language keeps its own-language title - only translate names that were themselves a translation.

NOT_INTERESTED RATINGS ARE A STRONG DISLIKE SIGNAL - don't discount an entry just because status is "not_interested"
and it has no star rating. This status means the user looked at the title (often an AI recommendation) and
actively rejected it - that is meaningful, deliberate negative signal, arguably as valuable as a 1-star watched
rating. If a "why" is given on a not_interested entry, treat it with the same weight as a why on any other rating
when building generalDislikes/nuances/genres. If several not_interested entries share a pattern (a genre, a theme,
a tone), name that pattern explicitly rather than treating each rejection as an isolated data point.

ADDITIONAL SIGNALS TO LOOK FOR - each RATINGS entry below now carries extra metadata beyond name/stars/why (genres,
a short plot summary, runtime or season/episode shape, RT/IMDb scores, content rating, director/creator, cast).
The genres field is the title's REAL genre list (not a guess) - use it directly for the "genres" output field rather
than inferring genre from the name alone, and cross-reference it against stars/why to set confidence (a genre they
keep rating highly = high confidence; one they keep rating low or marking not_interested = leave out or note as a
dislike instead). The plot summary is there so you can spot thematic/content patterns (e.g. grief, found family,
unreliable narrators, morally grey leads) for the themes/nuances fields even across titles with different genres -
don't just restate the plot, name the underlying pattern once it shows up across more than one rating. Look for
real patterns across MULTIPLE ratings and report them via the DEDICATED fields below (favoriteCreators,
viewingHabits) so they're individually visible and editable on the user's Preferences page, rather than burying
them in generic notes - do NOT force a pattern from a single data point or thin data, and leave a field empty if
nothing is clear yet:
  - Runtime/length comfort -> viewingHabits: do they consistently rate long movies (2.5h+) or many-season TV
    commitments lower, or does length not seem to matter to them?
  - Quality bar -> viewingHabits: do their high ratings cluster around high RT/IMDb scores (drawn to critical
    acclaim), or do they rate strongly regardless of critical reception?
  - Era/recency -> viewingHabits: do they gravitate toward recent releases, older/classic titles, or does era not
    matter to them?
  - Content rating/maturity -> viewingHabits: any pattern around family-friendly vs. mature content - especially if
    a rating's "why" mentions watching with family?
  - Ongoing vs. ended shows -> viewingHabits: any sign they prefer shows that have already concluded over ones
    still airing (or the reverse)?
  - Director/creator/cast affinity -> favoriteCreators: if the SAME director, creator, or actor appears in two or
    more positively-rated titles, name that specific person - this is a strong, concrete signal.

Keep every field within its stated limit below EVEN AS the amount of ratings grows - pick the most
distinctive, highest-signal points rather than trying to cover everything. This profile is meant to read as a
handful of sharp chips/notes on a page, not an exhaustive essay.

CONCISENESS IS A HARD REQUIREMENT, not a suggestion - the array-length caps below are maximums, and every
individual note also has its own strict length cap (given per field). When citing example titles inside a note,
name AT MOST 2 - never list every supporting title you can think of. Going over a cap is treated as a failed
response, so when in doubt, cut rather than pad.

Respond with ONLY a single JSON object - no prose, no markdown code fences - matching exactly this shape:
{
  "generalLikes": string[] (at most 8 short phrases, e.g. "earned plot twists"),
  "generalDislikes": string[] (at most 8 short phrases, e.g. "gore or jump scares"),
  "genres": [{ "name": string, "confidence": number from 1 to 5 }] (at most 8 genres),
  "storytelling": string[] (at most 6 notes, ONE sentence and under 25 words each, on what makes content click for this user),
  "languages": string[] (at most 5 languages/regions the user seems comfortable with),
  "themes": string[] (at most 8 short phrases naming recurring themes/motifs),
  "nuances": string[] (at most 6 notes, ONE sentence and under 25 words each, on important edge cases/contradictions, e.g. "horror OK only when psychological, not gory"),
  "favoriteCreators": string[] (at most 6 names of directors/creators/actors this user seems drawn to, each appearing in 2+ positively-rated titles - empty array if none clear yet),
  "viewingHabits": string[] (at most 6 notes, ONE sentence and under 25 words each, on runtime/length comfort, quality-bar leaning, era/recency preference, content-rating comfort, or ongoing-vs-ended show preference - only include a note when a real pattern is visible),
  "summary": string (STRICT maximum 4 sentences and 100 words total - the "ideal content formula", not a recap of their whole history)
}`;

  const prompt = `EXISTING PROFILE (empty if this is the first analysis):
${
  existingProfile
    ? JSON.stringify(
        {
          generalLikes: existingProfile.generalLikes,
          generalDislikes: existingProfile.generalDislikes,
          genres: existingProfile.genres,
          storytelling: existingProfile.storytelling,
          languages: existingProfile.languages,
          themes: existingProfile.themes,
          nuances: existingProfile.nuances,
          favoriteCreators: existingProfile.favoriteCreators,
          viewingHabits: existingProfile.viewingHabits,
          summary: existingProfile.summary,
        },
        null,
        2
      )
    : "(none yet)"
}

RATINGS (most recent first):
${ratingsSummary || "(none yet)"}

Produce the updated profile JSON now.`;

  // This response has 8 fields (some are arrays that grow with the user's
  // rating history) - too tight a cap truncates the JSON mid-string and the
  // whole analysis fails to parse (verified: even 2000, then 3500, wasn't
  // enough once a user's rating history grew past ~30-40 titles, even with
  // the per-field length caps in the prompt above - the model doesn't always
  // hold to them exactly). Correctness matters more than the marginal token
  // cost of leaving real headroom here, so this is set well above what a
  // fully-compliant response would need rather than tuned to the minimum.
  //
  // cacheSystemPrompt: this system prompt is ~1850 tokens, fully static (no
  // per-user interpolation), and runs on Sonnet 5 (1024-token cache minimum -
  // comfortably cleared) after every single rating. Prompt caching means only
  // the first call after the 5-minute TTL pays full input price; every call
  // during active use reads the cached prefix at ~10% of the cost.
  // usage is tracked in `finally` (not right after the call) so a malformed-
  // JSON response - a real, billed API call that just failed to parse -
  // still gets its cost recorded instead of silently vanishing. See
  // askClaudeForJSON's comment on why the error carries `usage` too.
  let usage;
  try {
    const response = await askClaudeForJSON({
      system,
      prompt,
      maxTokens: 6000,
      model: getProfileModel(),
      cacheSystemPrompt: true,
    });
    usage = response.usage;
    const result = response.data;

    return await updateProfile(userId, {
      generalLikes: Array.isArray(result.generalLikes) ? result.generalLikes : [],
      generalDislikes: Array.isArray(result.generalDislikes) ? result.generalDislikes : [],
      genres: Array.isArray(result.genres) ? result.genres : [],
      storytelling: Array.isArray(result.storytelling) ? result.storytelling : [],
      languages: Array.isArray(result.languages) ? result.languages : [],
      themes: Array.isArray(result.themes) ? result.themes : [],
      nuances: Array.isArray(result.nuances) ? result.nuances : [],
      favoriteCreators: Array.isArray(result.favoriteCreators) ? result.favoriteCreators : [],
      viewingHabits: Array.isArray(result.viewingHabits) ? result.viewingHabits : [],
      summary: typeof result.summary === "string" ? result.summary : existingProfile?.summary ?? null,
    });
  } catch (err) {
    if (err.usage) usage = err.usage;
    throw err;
  } finally {
    await trackCostEvent(userId, EVENT_NAMES.COST_PROFILE_ANALYSIS, usage);
    // Energy-system cost visibility (see lib/energy.js) - logged alongside
    // the dollar-cost event above regardless of caller (explicit button,
    // chatbot tool, or the debounced batch trigger below), since a real API
    // call was attempted either way. Never blocks/notifies - see
    // maybeAnalyzePreferences for the actual 24h debounce gate.
    if (usage) await logTasteProfileAnalysis(userId);
  }
}

// How many new ratings/triages accumulate before a background profile
// refresh actually fires. analyzePreferences is a real Sonnet 5 call, and
// firing it after every single rating (the original behavior) got expensive
// fast during an active rating session - most of those calls were nearly
// redundant with the one before. Batching trades a bit of profile freshness
// (it can lag up to PROFILE_SYNC_BATCH_SIZE - 1 ratings behind) for roughly
// a 3x cut in Sonnet calls. The very first rating always runs immediately
// (no profile exists yet, so there's nothing to batch) - see the `!profile`
// check below.
const PROFILE_SYNC_BATCH_SIZE = 3;

/**
 * The batched entry point for "a rating/triage changed, maybe refresh the
 * profile" - use this instead of calling analyzePreferences directly from
 * anywhere new ratings get saved (POST /api/ratings, recommendation triage,
 * the chatbot's tool loop). Always runs on the very first rating (so a
 * profile exists as soon as there's any signal at all); after that, only
 * every PROFILE_SYNC_BATCH_SIZE-th rating actually triggers a real call.
 * Deleting a rating (DELETE /api/ratings) and the "Ask AI to re-analyze"
 * button on My Preferences intentionally skip this and call
 * analyzePreferences directly instead - both are explicit, infrequent
 * corrections where the user is owed an immediate, accurate result rather
 * than a batched one.
 *
 * Also gated by a separate 24h debounce (see lib/energy.js
 * tryClaimProfileAnalysisSlot) on top of the batching above - this is the
 * "regardless of rating volume" cap on the priciest single AI action in the
 * app, which isn't user-facing spend (see that file's header comment) so it
 * never blocks or notifies, it just silently skips this one call if the
 * slot's already been used in the last 24h. Scoped to this implicit,
 * rating-driven trigger only - the explicit paths above intentionally
 * bypass it, same as they bypass the batching.
 */
export async function maybeAnalyzePreferences(userId) {
  const [totalRatings, profile] = await Promise.all([
    prisma.rating.count({ where: { userId } }),
    getProfile(userId),
  ]);

  if (!profile || totalRatings % PROFILE_SYNC_BATCH_SIZE === 0) {
    const claimed = await tryClaimProfileAnalysisSlot(userId);
    if (!claimed) return null;
    return analyzePreferences(userId);
  }
  return null;
}

// A compact, plain-text description of a profile - used inside prompts for
// recommendations and the chatbot instead of pasting the full profile JSON
// into every single request.
export function profileToPromptSummary(profile, user) {
  if (!profile) {
    return "This user has no preference profile yet - little is known about their taste so far.";
  }

  const parts = [];
  if (profile.genres?.length) {
    parts.push(`Favorite genres (confidence 1-5): ${profile.genres.map((g) => `${g.name} (${g.confidence})`).join(", ")}`);
  }
  if (profile.generalLikes?.length) parts.push(`Drawn to: ${profile.generalLikes.join(", ")}`);
  if (profile.generalDislikes?.length) parts.push(`Avoids: ${profile.generalDislikes.join(", ")}`);
  if (profile.storytelling?.length) parts.push(`What makes content click: ${profile.storytelling.join("; ")}`);
  if (profile.themes?.length) parts.push(`Recurring themes: ${profile.themes.join(", ")}`);
  if (profile.nuances?.length) parts.push(`Important nuances: ${profile.nuances.join("; ")}`);
  if (profile.favoriteCreators?.length) {
    parts.push(`Favorite directors/creators/actors: ${profile.favoriteCreators.join(", ")}`);
  }
  if (profile.viewingHabits?.length) parts.push(`Viewing habits: ${profile.viewingHabits.join("; ")}`);
  if (profile.languages?.length) parts.push(`Comfortable with languages: ${profile.languages.join(", ")}`);
  if (profile.demographicsConsider) parts.push(`Demographics/origin openness: ${profile.demographicsConsider}`);
  if (profile.summary) parts.push(`Summary: ${profile.summary}`);

  if (user) {
    const services = JSON.parse(user.streamingServices || "[]");
    if (services.length) {
      parts.push(
        `Streaming services: ${services.join(", ")}${
          user.openToOtherStreaming ? " (open to other services too)" : " (prefers to stick to these)"
        }`
      );
    }
    if (user.location) parts.push(`Located in: ${user.location}`);
  }

  return parts.join("\n") || "This user has no preference profile yet.";
}

export { deserializeProfile };
