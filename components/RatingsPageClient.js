"use client";

import { useEffect, useState } from "react";
import StarRating from "@/components/StarRating";
import TitlePoster from "@/components/TitlePoster";
import TitleMeta from "@/components/TitleMeta";
import Toast from "@/components/Toast";
import { useToast } from "@/lib/useToast";
import { useTitleSearch } from "@/lib/useTitleSearch";
import SearchRefineHint from "@/components/SearchRefineHint";
import { RATINGS_GOAL, RECOMMENDED_RATINGS_GOAL } from "@/lib/questions";

const STORAGE_KEY = "cinematch_hide_ratings_reminder";

// This page is only for titles you've already watched, in real life, and
// want to rate - want-to-watch and not-interested live on the Wishlist and
// Recommendations pages instead. See app/ratings/page.js for the split.
export default function RatingsPageClient({ guidedQuestions }) {
  const [showReminder, setShowReminder] = useState(true);
  const {
    query,
    setQuery,
    searching,
    searchError,
    selectedTitle,
    candidates,
    loadingCandidates,
    search,
    showOtherMatches,
    selectCandidate,
  } = useTitleSearch();

  const [stars, setStars] = useState(0);
  const [why, setWhy] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");

  const [recentRatings, setRecentRatings] = useState([]);
  const [watchedCount, setWatchedCount] = useState(0);
  const [toast, showToast, dismissToast] = useToast();

  useEffect(() => {
    if (typeof window !== "undefined" && window.localStorage.getItem(STORAGE_KEY) === "1") {
      setShowReminder(false);
    }
    loadRecentRatings();
  }, []);

  useEffect(() => {
    // A fresh title (from either search tier) starts with a clean rating form.
    if (selectedTitle) {
      setStars(0);
      setWhy("");
      setSaveMessage("");
    }
  }, [selectedTitle]);

  async function loadRecentRatings() {
    const res = await fetch("/api/ratings");
    if (res.ok) {
      const data = await res.json();
      setRecentRatings((data.ratings || []).filter((r) => r.status === "watched"));
      setWatchedCount(data.watchedCount || 0);
    }
  }

  function dismissReminder() {
    setShowReminder(false);
    if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, "1");
  }

  async function handleSave() {
    if (!selectedTitle) return;
    setSaving(true);
    setSaveMessage("");
    try {
      const res = await fetch("/api/ratings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          titleId: selectedTitle.id,
          status: "watched",
          stars: stars || null,
          why: why || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save rating.");

      showToast(`"${selectedTitle.name}" rated and saved!`, "You can see it on the Watched page - every rating sharpens your recommendations.");
      await loadRecentRatings();
    } catch (err) {
      setSaveMessage(err.message);
    } finally {
      setSaving(false);
    }
  }

  // Tracks toward RECOMMENDED_RATINGS_GOAL (10), same reasoning as the Home
  // page: this reads as "how rich is my profile", which keeps improving
  // past the lower RATINGS_GOAL (5) unlock threshold - that unlock gets its
  // own callout below instead of being what "done" means here.
  const progressPct = Math.min(100, Math.round((watchedCount / RECOMMENDED_RATINGS_GOAL) * 100));

  return (
    <>
      {toast && <Toast key={toast.key} message={toast.message} guidance={toast.guidance} onDismiss={dismissToast} />}

      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <strong style={{ fontSize: 14 }}>
            {watchedCount >= RECOMMENDED_RATINGS_GOAL
              ? `${watchedCount} titles rated — your profile has plenty to work with, and every one you add still helps.`
              : watchedCount >= RATINGS_GOAL
              ? `${watchedCount} titles rated — Recommendations are unlocked! Keep going for even better picks.`
              : `Rate at least ${RATINGS_GOAL} titles to unlock Recommendations`}
          </strong>
          <span className="muted">
            {Math.min(watchedCount, RECOMMENDED_RATINGS_GOAL)}/{RECOMMENDED_RATINGS_GOAL}
          </span>
        </div>
        <div className="progress-bar">
          <div className="progress-bar-fill" style={{ width: `${progressPct}%` }} />
        </div>
      </div>

      {showReminder && (
        <div className="onboarding-banner" style={{ padding: "12px 16px", marginBottom: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <strong style={{ color: "var(--color-accent-800)", fontSize: 13 }}>Need ideas?</strong>
            <button className="btn btn-outline" style={{ padding: "1px 8px" }} onClick={dismissReminder}>
              x
            </button>
          </div>
          <p className="muted" style={{ margin: "4px 0 0" }}>
            {guidedQuestions
              .slice(0, 3)
              .map((q) => `"${q.text}"`)
              .join("  ·  ")}
          </p>
        </div>
      )}

      <form onSubmit={search} className="card">
        <label htmlFor="search">Search a movie or TV show you&apos;ve already watched</label>
        <div style={{ display: "flex", gap: 10 }}>
          <input
            id="search"
            type="search"
            style={{ marginBottom: 0 }}
            placeholder='e.g. "Breaking Bad"'
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button className="btn btn-primary" type="submit" disabled={searching}>
            {searching ? "Searching..." : "Search"}
          </button>
        </div>
        {searchError && <p className="error-text" style={{ marginTop: 10 }}>{searchError}</p>}
        <p className="muted" style={{ marginTop: 10, marginBottom: 0 }}>
          Haven&apos;t watched it yet? Add it to your <a href="/wishlist">Wishlist</a> instead.
        </p>
      </form>

      {selectedTitle && (
        <div className="card">
          <div className="detail-row">
            <div className="detail-poster">
              <TitlePoster title={selectedTitle} />
            </div>
            <div className="detail-body">
              <h3 style={{ margin: "0 0 4px" }}>
                {selectedTitle.name} {selectedTitle.year ? `(${selectedTitle.year})` : ""}
              </h3>
              <TitleMeta title={selectedTitle} />
              <p className="muted">{selectedTitle.genres?.join(" / ") || "Genres unknown"}</p>

              <label>Your rating</label>
              <div style={{ marginBottom: 14 }}>
                <StarRating value={stars} onChange={setStars} />
              </div>

              <label htmlFor="why">Why? (optional — more detail helps the AI more)</label>
              <textarea
                id="why"
                placeholder="e.g. The slow-burn tension and morally grey characters got me - the ambiguous ending fit the tone perfectly."
                value={why}
                onChange={(e) => setWhy(e.target.value)}
              />

              <button className="btn btn-success" onClick={handleSave} disabled={saving}>
                {saving ? "Saving..." : "Save Rating"}
              </button>
              {saveMessage && <p className="error-text" style={{ marginTop: 10 }}>{saveMessage}</p>}

              <SearchRefineHint
                candidates={candidates}
                loadingCandidates={loadingCandidates}
                onShowOtherMatches={showOtherMatches}
                onSelectCandidate={selectCandidate}
              />
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <h3>Recently rated</h3>
        {recentRatings.length === 0 ? (
          <p className="muted">Nothing rated yet - search for a title above to get started.</p>
        ) : (
          <p className="muted">
            {recentRatings.map((r) => `${r.title.name}${r.stars ? ` (${r.stars}/5)` : ""}`).join("  ·  ")}
          </p>
        )}
      </div>
    </>
  );
}
