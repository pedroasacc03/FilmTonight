"use client";

import { useState } from "react";

// Shows a title's real poster (from TMDB, see lib/titles.js) inside a matted
// placeholder box, falling back to a name-only box when there's no poster or
// the image fails to load. This used to be name-only unconditionally: an
// earlier AI-web-search-based lookup fabricated plausible-looking poster
// URLs that mostly 404'd (verified against real data: only ~1 of 66 cached
// titles ever had one that actually loaded), so posters were dropped
// app-wide rather than show a broken image most of the time. TMDB's
// poster_path is a real, verified field - not a guess - so this is safe to
// bring back now; the onError fallback below is just defense-in-depth for
// the rare CDN hiccup, not the common case it used to be.
export default function TitlePoster({ title }) {
  const [imageFailed, setImageFailed] = useState(false);
  const posterUrl = title?.posterUrl;

  return (
    <div className="title-poster-placeholder">
      {posterUrl && !imageFailed ? (
        <img
          src={posterUrl}
          alt={title?.name ? `${title.name} poster` : "Poster"}
          onError={() => setImageFailed(true)}
        />
      ) : (
        <span style={{ padding: 6, textAlign: "center" }}>{title?.name || "Poster"}</span>
      )}
    </div>
  );
}
