// Looks up movie/TV metadata (genres, streaming availability, RT/IMDb
// scores, etc.) and caches it locally.
//
// This used to ask Claude to search the web for this data (see git history),
// but that was both the single biggest cost driver in the app (a full
// agentic web-search loop per uncached title) and the single biggest source
// of latency (multiple sequential search round-trips before an answer came
// back). Structured movie/TV data is exactly what TMDB (The Movie Database)
// and OMDb already provide as fast, free, direct API calls - no LLM
// involved at all for this step now. TMDB covers everything except RT/IMDb
// scores; OMDb (keyed by the IMDb id TMDB gives us) covers those two.
//
// One real behavior change from the AI-search version: genres/etc. now
// reflect TMDB's own taxonomy and OMDb's own scores, rather than an LLM's
// free-form judgment - e.g. TMDB has no "Sport" genre the way the old AI
// answers sometimes did. That's an expected, acceptable side effect of
// using a real structured source instead of an LLM guessing.
//
// Later lookups for the same title reuse the cached Title row until it goes
// stale (CACHE_TTL_DAYS), so we're not re-hitting either API on every page load.

import { prisma } from "@/lib/prisma";
import { TITLE_TYPES } from "@/lib/questions";

const CACHE_TTL_DAYS = 30;
const TMDB_API_BASE = "https://api.themoviedb.org/3";
const OMDB_API_BASE = "https://www.omdbapi.com";
// w342 is a good balance for the ~100-180px-wide poster columns this app
// actually renders at (crisp on retina without fetching full-size originals).
// See https://developer.themoviedb.org/docs/image-basics for the fixed set
// of sizes TMDB serves - this one isn't guessable/invented, it's from that list.
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w342";

function buildPosterUrl(posterPath) {
  return posterPath ? `${TMDB_IMAGE_BASE}${posterPath}` : null;
}

// Prisma/SQLite stores JSON as plain strings (see prisma/schema.prisma).
// This turns a Title row from the database into a "nice" JS object with
// real arrays, for use everywhere else in the app.
function deserializeTitle(row) {
  if (!row) return null;
  return {
    ...row,
    genres: JSON.parse(row.genres || "[]"),
    streamingAvailability: JSON.parse(row.streamingAvailability || "[]"),
    cast: JSON.parse(row.cast || "[]"),
  };
}

// SQLite's unique constraints treat every NULL as distinct from every other
// NULL, so two titles with an unknown year wouldn't be recognized as
// duplicates. We sidestep that by using 0 to mean "unknown year" internally.
function normalizeYear(year) {
  return typeof year === "number" && Number.isFinite(year) ? year : 0;
}

function parseYearFrom(dateStr) {
  if (!dateStr) return null;
  const y = parseInt(dateStr.slice(0, 4), 10);
  return Number.isFinite(y) ? y : null;
}

// --- TMDB genre id -> name maps (movie + TV lists merged; the handful of
// ids shared between both lists mean the same thing in each, e.g. 18 Drama).
// These are TMDB's fixed, documented genre lists, not expected to change -
// see https://developer.themoviedb.org/reference/genre-movie-list /
// genre-tv-list. Used only for the short "detail" phrase on search
// candidates (see findTitleCandidates below); the real genres list for a
// saved Title comes straight from the details endpoint, not this map.
const GENRE_NAMES = {
  28: "Action", 12: "Adventure", 16: "Animation", 35: "Comedy", 80: "Crime",
  99: "Documentary", 18: "Drama", 10751: "Family", 14: "Fantasy", 36: "History",
  27: "Horror", 10402: "Music", 9648: "Mystery", 10749: "Romance",
  878: "Science Fiction", 10770: "TV Movie", 53: "Thriller", 10752: "War", 37: "Western",
  10759: "Action & Adventure", 10762: "Kids", 10763: "News", 10764: "Reality",
  10765: "Sci-Fi & Fantasy", 10766: "Soap", 10767: "Talk", 10768: "War & Politics",
};

// A small set of common ISO 639-1 codes -> readable names, for
// Title.language (TMDB only gives the raw code). Falls back to the raw code
// for anything not listed here rather than failing.
const LANGUAGE_NAMES = {
  en: "English", pt: "Portuguese", es: "Spanish", fr: "French", de: "German",
  it: "Italian", ja: "Japanese", ko: "Korean", zh: "Chinese", hi: "Hindi",
  ru: "Russian", ar: "Arabic", nl: "Dutch", sv: "Swedish", no: "Norwegian",
  da: "Danish", fi: "Finnish", pl: "Polish", tr: "Turkish", th: "Thai",
};

// User.location is free text (e.g. "São Paulo, Brazil"), but TMDB's watch
// providers endpoint is keyed by ISO 3166-1 country code. This covers common
// country names/aliases; anything unmatched falls back to "US" - the same
// default the app already uses elsewhere (see the "No thanks, use US" button
// on the Recommendations page's region prompt). NOTE: this only decides
// which country's providers we fetch - the exact free-text region the user
// entered is still stored as-is in Title.streamingRegion (see
// components/StreamingInfo.js, which compares that raw text against the
// viewer's own location - resolving both sides to a code would lose the
// ability to warn "checked for X, not your region Y" in the user's own words).
const COUNTRY_CODES = {
  "united states": "US", usa: "US", us: "US", america: "US",
  "united kingdom": "GB", uk: "GB", britain: "GB", england: "GB", scotland: "GB", wales: "GB",
  brazil: "BR", brasil: "BR",
  canada: "CA", australia: "AU",
  germany: "DE", deutschland: "DE",
  france: "FR",
  spain: "ES", "españa": "ES",
  italy: "IT", italia: "IT",
  portugal: "PT",
  mexico: "MX", "méxico": "MX",
  japan: "JP",
  "south korea": "KR", korea: "KR",
  india: "IN",
  netherlands: "NL", holland: "NL",
  sweden: "SE", norway: "NO", denmark: "DK", finland: "FI",
  poland: "PL",
  argentina: "AR", chile: "CL", colombia: "CO", peru: "PE",
  ireland: "IE", belgium: "BE", switzerland: "CH", austria: "AT",
  "new zealand": "NZ", "south africa": "ZA",
  china: "CN", "hong kong": "HK", taiwan: "TW", singapore: "SG",
  philippines: "PH", indonesia: "ID", thailand: "TH", vietnam: "VN", malaysia: "MY",
  turkey: "TR", israel: "IL",
  "united arab emirates": "AE", uae: "AE",
  "saudi arabia": "SA", egypt: "EG",
  russia: "RU", ukraine: "UA", greece: "GR",
  "czech republic": "CZ", czechia: "CZ",
  hungary: "HU", romania: "RO",
};

function resolveCountryCode(regionText) {
  if (!regionText) return "US";
  // A location like "São Paulo, Brazil" - the country is usually the last
  // comma-separated segment, so check from the end.
  const segments = regionText.split(",").map((s) => s.trim().toLowerCase());
  for (let i = segments.length - 1; i >= 0; i--) {
    if (COUNTRY_CODES[segments[i]]) return COUNTRY_CODES[segments[i]];
  }
  return "US";
}

function getTmdbApiKey() {
  const key = process.env.TMDB_API_KEY;
  if (!key) {
    throw new Error(
      "TMDB_API_KEY is not set. Get a free key at https://www.themoviedb.org/settings/api and add it to .env."
    );
  }
  return key;
}

async function tmdbFetch(path, params = {}) {
  const url = new URL(`${TMDB_API_BASE}${path}`);
  url.searchParams.set("api_key", getTmdbApiKey());
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, value);
  }
  const res = await fetch(url.toString());
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`TMDB request failed (${res.status}) for ${path}`);
  return res.json();
}

// Searches TMDB's combined movie+TV search, returning candidates ranked by
// TMDB's own popularity score (a reasonable proxy for "which real title did
// the user most likely mean" when the query is ambiguous).
async function searchTmdb(query, { type } = {}) {
  const data = await tmdbFetch("/search/multi", { query, include_adult: "false" });
  if (!data?.results?.length) return [];

  return data.results
    .filter((r) => r.media_type === "movie" || r.media_type === "tv")
    .filter((r) => !type || r.media_type === type)
    .map((r) => ({
      tmdbId: r.id,
      type: r.media_type,
      // The "official title, original production language" naming rule this
      // app has always used falls straight out of TMDB's original_title/
      // original_name fields - no translation logic needed on our end.
      name: r.media_type === "movie" ? r.original_title || r.title : r.original_name || r.name,
      displayName: r.media_type === "movie" ? r.title : r.name,
      year: parseYearFrom(r.media_type === "movie" ? r.release_date : r.first_air_date),
      popularity: r.popularity || 0,
      genreNames: (r.genre_ids || []).map((id) => GENRE_NAMES[id]).filter(Boolean),
      posterPath: r.poster_path || null,
    }))
    .sort((a, b) => b.popularity - a.popularity);
}

async function fetchTmdbDetails(tmdbId, type, regionCode) {
  const isMovie = type === "movie";
  const [details, providers] = await Promise.all([
    tmdbFetch(`/${type}/${tmdbId}`, {
      append_to_response: isMovie ? "credits,release_dates,external_ids" : "credits,content_ratings,external_ids",
    }),
    tmdbFetch(`/${type}/${tmdbId}/watch/providers`),
  ]);
  if (!details) return null;

  const name = isMovie ? details.original_title || details.title : details.original_name || details.name;
  const year = normalizeYear(parseYearFrom(isMovie ? details.release_date : details.first_air_date));
  const cast = (details.credits?.cast || []).slice(0, 5).map((c) => c.name);

  let director = null;
  let creator = null;
  if (isMovie) {
    director = (details.credits?.crew || []).find((c) => c.job === "Director")?.name || null;
  } else {
    creator = (details.created_by || []).map((c) => c.name).join(", ") || null;
  }

  let contentRating = null;
  if (isMovie) {
    const usRelease = (details.release_dates?.results || []).find((r) => r.iso_3166_1 === "US");
    contentRating = usRelease?.release_dates?.find((rd) => rd.certification)?.certification || null;
  } else {
    contentRating = (details.content_ratings?.results || []).find((r) => r.iso_3166_1 === "US")?.rating || null;
  }

  const showStatus = isMovie ? null : ["Ended", "Canceled"].includes(details.status) ? "ended" : "ongoing";

  const regionProviders = providers?.results?.[regionCode];
  const streamingAvailability = (regionProviders?.flatrate || []).map((p) => p.provider_name);

  return {
    imdbId: details.external_ids?.imdb_id || null,
    name,
    year,
    type,
    genres: (details.genres || []).map((g) => g.name),
    overview: details.overview || null,
    posterUrl: buildPosterUrl(details.poster_path),
    runtimeMinutes: isMovie ? details.runtime || null : null,
    seasons: isMovie ? null : details.number_of_seasons || null,
    avgEpisodesPerSeason:
      !isMovie && details.number_of_seasons
        ? Math.round((details.number_of_episodes || 0) / details.number_of_seasons) || null
        : null,
    avgEpisodeRuntimeMinutes: isMovie ? null : details.episode_run_time?.[0] || null,
    releaseDate: (isMovie ? details.release_date : details.first_air_date) || null,
    countryOfOrigin: isMovie ? details.production_countries?.[0]?.name || null : details.origin_country?.[0] || null,
    language: LANGUAGE_NAMES[details.original_language] || details.original_language || null,
    contentRating,
    director,
    creator,
    cast,
    showStatus,
    streamingAvailability,
  };
}

// OMDb (keyed by IMDb id) is the one piece TMDB doesn't have: Rotten
// Tomatoes and IMDb scores. Best-effort - a missing OMDB_API_KEY, a title
// OMDb doesn't have, or a request failure all just mean the scores stay
// null rather than failing the whole lookup, since they're a nice-to-have
// signal, not a required field.
async function fetchOmdbScores(imdbId) {
  const apiKey = process.env.OMDB_API_KEY;
  if (!apiKey || !imdbId) return { rtScore: null, imdbScore: null };

  try {
    const res = await fetch(`${OMDB_API_BASE}/?apikey=${apiKey}&i=${imdbId}`);
    if (!res.ok) return { rtScore: null, imdbScore: null };
    const data = await res.json();
    if (data.Response === "False") return { rtScore: null, imdbScore: null };

    const imdbScore = parseFloat(data.imdbRating);
    const rtEntry = (data.Ratings || []).find((r) => r.Source === "Rotten Tomatoes");
    const rtScore = rtEntry ? parseInt(rtEntry.Value, 10) : null; // "92%" -> 92

    return {
      rtScore: Number.isFinite(rtScore) ? rtScore : null,
      imdbScore: Number.isFinite(imdbScore) ? imdbScore : null,
    };
  } catch (err) {
    console.error("OMDb lookup failed:", err.message);
    return { rtScore: null, imdbScore: null };
  }
}

/**
 * Find a title by name (optionally narrowed by year/type/region), looking it
 * up on TMDB/OMDb if we don't already have a fresh cached copy.
 *
 * `options.region` (e.g. "Brazil", "United States") only affects a fresh
 * lookup's streamingAvailability - Title rows are a single global cache keyed
 * on name+year (not per-region), so a title reused from cache keeps whatever
 * region's availability it was last looked up with (recorded in
 * `streamingRegion`, null if no region was known at lookup time) until the
 * 30-day TTL forces a refresh. Whoever renders streamingAvailability is
 * responsible for comparing `streamingRegion` against the CURRENT viewer's
 * own region and warning them if it doesn't match - see components/StreamingInfo.js.
 * See lib/recommendations.js and app/api/titles/search/route.js for where
 * `options.region` is passed in.
 *
 * Returns a deserialized Title object, or null if no such title could be found.
 */
export async function findOrLookupTitle(query, options = {}) {
  const normalizedQuery = (query || "").trim();
  if (!normalizedQuery) throw new Error("Title query cannot be empty");

  // 1. Look for a cached match. SQLite's LIKE (which Prisma's `contains`
  // uses) is case-insensitive for ASCII text, so this catches most casing
  // differences without needing Postgres-only features like `mode: "insensitive"`.
  const candidates = await prisma.title.findMany({
    where: { name: { contains: normalizedQuery } },
    orderBy: { lastRefreshed: "desc" },
    take: 5,
  });

  const exactMatch = candidates.find((c) => {
    const nameMatches = c.name.toLowerCase() === normalizedQuery.toLowerCase();
    const yearMatches = !options.year || c.year === options.year;
    return nameMatches && yearMatches;
  });

  if (exactMatch) {
    const ageDays = (Date.now() - new Date(exactMatch.lastRefreshed).getTime()) / (1000 * 60 * 60 * 24);
    if (ageDays < CACHE_TTL_DAYS) {
      return deserializeTitle(exactMatch);
    }
    // else: fall through and refresh it via a fresh lookup below
  }

  // 2. Not cached (or stale) - resolve it via TMDB search, then fetch full details.
  const results = await searchTmdb(normalizedQuery, { type: options.type });
  if (!results.length) return null;

  let best = results[0];
  if (options.year) {
    const yearMatch = results.find((r) => r.year === options.year);
    if (yearMatch) best = yearMatch;
  }

  const regionCode = resolveCountryCode(options.region);
  const details = await fetchTmdbDetails(best.tmdbId, best.type, regionCode);
  if (!details) return null;

  const { rtScore, imdbScore } = await fetchOmdbScores(details.imdbId);

  const type = TITLE_TYPES.includes(details.type) ? details.type : "movie";

  const data = {
    name: details.name,
    year: details.year,
    type,
    genres: JSON.stringify(details.genres),
    overview: details.overview,
    // A real, verified TMDB CDN URL - not an AI guess. This used to always
    // be null: an earlier AI-web-search-based lookup fabricated plausible-
    // looking poster URLs that mostly 404'd (verified: only ~1/66 loaded),
    // so posters were dropped app-wide rather than show a broken image most
    // of the time. TMDB's poster_path is a real field in the same details
    // response already being fetched for genres/cast/etc, not a guess - if
    // TMDB doesn't have one, this is just null, never a fake link.
    posterUrl: details.posterUrl,
    runtimeMinutes: details.runtimeMinutes,
    seasons: details.seasons,
    avgEpisodesPerSeason: details.avgEpisodesPerSeason,
    avgEpisodeRuntimeMinutes: details.avgEpisodeRuntimeMinutes,
    releaseDate: details.releaseDate,
    countryOfOrigin: details.countryOfOrigin,
    language: details.language,
    contentRating: details.contentRating,
    director: details.director,
    creator: details.creator,
    cast: JSON.stringify(details.cast),
    showStatus: details.showStatus,
    streamingAvailability: JSON.stringify(details.streamingAvailability),
    streamingRegion: options.region || null,
    rtScore,
    imdbScore,
    lastRefreshed: new Date(),
  };

  const saved = await prisma.title.upsert({
    where: { name_year: { name: data.name, year: data.year } },
    update: data,
    create: data,
  });

  return deserializeTitle(saved);
}

/**
 * Lightweight, OPT-IN disambiguation: returns up to 4 plausible candidate
 * titles (name/year/type/one distinguishing phrase only - no overview,
 * streaming, scores, etc.) for when findOrLookupTitle's single best guess
 * wasn't the right one. Deliberately cheap and separate from
 * findOrLookupTitle: most searches already resolve correctly on the first
 * try, so this only runs when a user explicitly asks "show other matches" -
 * it doesn't cache anything, since most candidates will never be picked.
 * Once the user picks one, call findOrLookupTitle(name, {year, type}) to do
 * the real (cached) lookup for that specific title.
 */
export async function findTitleCandidates(query) {
  const normalizedQuery = (query || "").trim();
  if (!normalizedQuery) throw new Error("Title query cannot be empty");

  const results = await searchTmdb(normalizedQuery);
  return results.slice(0, 4).map((r) => ({
    name: r.displayName || r.name,
    year: r.year,
    type: r.type,
    detail:
      [r.year, r.genreNames.slice(0, 2).join("/")].filter(Boolean).join(" · ") ||
      (r.type === "tv" ? "TV show" : "movie"),
  }));
}

// Fetch a title we already have by id (no lookup) - used when we just
// need to display something we already saved, e.g. on the Recommendations page.
export async function getTitleById(titleId) {
  const row = await prisma.title.findUnique({ where: { id: titleId } });
  return deserializeTitle(row);
}

// One-off migration helper: posterUrl used to always be null (see the
// comment on it in findOrLookupTitle above) - any Title row cached before
// that changed only gets a poster the next time it's naturally re-looked-up
// (CACHE_TTL_DAYS, 30 days). This fills the gap immediately instead of
// waiting: a cheap TMDB search per title missing a poster (the search
// response already includes poster_path, so no extra details() call is
// needed just for this). Called from the admin-only, one-time "Backfill
// posters" button on /admin/metrics - not part of any regular user-facing
// flow, and safe to call repeatedly (only ever touches rows still missing
// a poster). `limit` caps how many get processed in one call, since this is
// triggered from a web request with a timeout, not a background job.
export async function backfillMissingPosters(limit = 100) {
  const titles = await prisma.title.findMany({ where: { posterUrl: null }, take: limit });

  let updated = 0;
  const CONCURRENCY = 5;
  for (let i = 0; i < titles.length; i += CONCURRENCY) {
    const batch = titles.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async (t) => {
        const candidates = await searchTmdb(t.name, { type: TITLE_TYPES.includes(t.type) ? t.type : undefined });
        if (!candidates.length) return null;
        let best = candidates[0];
        if (t.year) {
          const yearMatch = candidates.find((c) => c.year === t.year);
          if (yearMatch) best = yearMatch;
        }
        return buildPosterUrl(best.posterPath);
      })
    );
    for (let j = 0; j < batch.length; j++) {
      const result = results[j];
      if (result.status === "rejected") {
        console.error(`Backfill: failed to look up poster for "${batch[j].name}":`, result.reason?.message);
        continue;
      }
      if (result.value) {
        await prisma.title.update({ where: { id: batch[j].id }, data: { posterUrl: result.value } });
        updated++;
      }
    }
  }

  return { checked: titles.length, updated, moreRemain: titles.length === limit };
}

export { deserializeTitle };
