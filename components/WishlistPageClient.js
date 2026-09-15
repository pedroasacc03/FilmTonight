"use client";

import { useState } from "react";
import TitlePoster from "@/components/TitlePoster";
import TitleMeta from "@/components/TitleMeta";
import StreamingInfo from "@/components/StreamingInfo";
import Toast from "@/components/Toast";
import { useToast } from "@/lib/useToast";
import { useTitleSearch } from "@/lib/useTitleSearch";
import SearchRefineHint from "@/components/SearchRefineHint";
import NotInterestedModal from "@/components/NotInterestedModal";
import RateModal from "@/components/RateModal";

export default function WishlistPageClient({ initialWishlist, userRegion }) {
  const [wishlist, setWishlist] = useState(initialWishlist);
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
    reset,
  } = useTitleSearch();
  const [adding, setAdding] = useState(false);
  const [toast, showToast, dismissToast] = useToast();

  // "Not interested" asks for an optional reason first (see NotInterestedModal).
  const [notInterestedTarget, setNotInterestedTarget] = useState(null); // wishlist item
  const [notInterestedReason, setNotInterestedReason] = useState("");
  const [submittingNotInterested, setSubmittingNotInterested] = useState(false);

  // "Mark Watched" asks for a rating right away (see RateModal) instead of
  // just hoping the user comes back to the Watched page later.
  const [rateTarget, setRateTarget] = useState(null); // wishlist item
  const [rateStars, setRateStars] = useState(0);
  const [rateWhy, setRateWhy] = useState("");
  const [submittingRate, setSubmittingRate] = useState(false);

  async function confirmAddToWishlist() {
    if (!selectedTitle) return;
    if (wishlist.some((w) => w.title.id === selectedTitle.id)) {
      showToast(`"${selectedTitle.name}" is already on your wishlist!`);
      reset();
      return;
    }
    setAdding(true);
    try {
      const res = await fetch("/api/ratings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ titleId: selectedTitle.id, status: "want_to_watch" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not add to wishlist.");
      setWishlist((prev) => [{ id: data.rating.id, stars: null, why: null, title: selectedTitle }, ...prev]);
      showToast(`"${selectedTitle.name}" added to your wishlist!`, "You'll find it right here whenever you're ready.");
      reset();
    } catch (err) {
      showToast(err.message);
    } finally {
      setAdding(false);
    }
  }

  // `status` here is a Rating status: "watched" | "not_interested".
  async function updateStatus(item, status, { reason, stars, why } = {}) {
    setWishlist((prev) => prev.filter((w) => w.id !== item.id));
    await fetch("/api/ratings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ titleId: item.title.id, status, why: (why ?? reason) || null, stars: stars ?? null }),
    });
    if (status === "watched") {
      showToast(
        stars ? `"${item.title.name}" rated and saved!` : `"${item.title.name}" marked as watched!`,
        stars ? "That sharpens your recommendations right away." : "You can rate it anytime from the Watched page."
      );
    } else {
      showToast(`Got it - "${item.title.name}" marked not interested.`, "We won't recommend it again.");
    }
  }

  function openNotInterested(item) {
    setNotInterestedReason("");
    setNotInterestedTarget(item);
  }

  async function confirmNotInterested() {
    if (!notInterestedTarget) return;
    setSubmittingNotInterested(true);
    await updateStatus(notInterestedTarget, "not_interested", { reason: notInterestedReason.trim() });
    setSubmittingNotInterested(false);
    setNotInterestedTarget(null);
  }

  function openRate(item) {
    setRateStars(0);
    setRateWhy("");
    setRateTarget(item);
  }

  async function confirmRate() {
    if (!rateTarget) return;
    setSubmittingRate(true);
    await updateStatus(rateTarget, "watched", { stars: rateStars || undefined, why: rateWhy.trim() || undefined });
    setSubmittingRate(false);
    setRateTarget(null);
  }

  async function skipRate() {
    if (!rateTarget) return;
    const target = rateTarget;
    setRateTarget(null);
    await updateStatus(target, "watched");
  }

  return (
    <>
      {toast && <Toast key={toast.key} message={toast.message} guidance={toast.guidance} onDismiss={dismissToast} />}

      <NotInterestedModal
        titleName={notInterestedTarget?.title?.name}
        reason={notInterestedReason}
        onReasonChange={setNotInterestedReason}
        onConfirm={confirmNotInterested}
        onCancel={() => setNotInterestedTarget(null)}
        submitting={submittingNotInterested}
      />

      <RateModal
        titleName={rateTarget?.title?.name}
        stars={rateStars}
        onStarsChange={setRateStars}
        why={rateWhy}
        onWhyChange={setRateWhy}
        onConfirm={confirmRate}
        onSkip={skipRate}
        submitting={submittingRate}
      />

      <form onSubmit={search} className="card">
        <label htmlFor="wishlist-search">Search a movie or TV show to add</label>
        <div style={{ display: "flex", gap: 10 }}>
          <input
            id="wishlist-search"
            type="search"
            style={{ marginBottom: 0 }}
            placeholder='e.g. "Dune: Part Two"'
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button className="btn btn-primary" type="submit" disabled={searching}>
            {searching ? "Searching..." : "Search"}
          </button>
        </div>
        {searchError && <p className="error-text" style={{ marginTop: 10 }}>{searchError}</p>}
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
              <StreamingInfo title={selectedTitle} userRegion={userRegion} />

              <button className="btn btn-success" onClick={confirmAddToWishlist} disabled={adding}>
                {adding ? "Adding..." : "Add to Wishlist"}
              </button>

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

      {wishlist.length === 0 ? (
        <p className="muted">
          Nothing on your wishlist yet — search above, or add a pick from the{" "}
          <a href="/recommendations">Recommendations page</a>.
        </p>
      ) : (
        wishlist.map((item) => (
          <div key={item.id} className="rec-card">
            <div className="poster">
              <TitlePoster title={item.title} />
            </div>
            <div className="body">
              <h3 style={{ margin: "0 0 4px" }}>
                {item.title.name} {item.title.year ? `(${item.title.year})` : ""}
              </h3>
              <TitleMeta title={item.title} />
              <p className="muted">{item.title.genres?.join(" / ") || "Genres unknown"}</p>
              <StreamingInfo title={item.title} userRegion={userRegion} />
            </div>
            <div className="actions">
              <button className="btn btn-success" onClick={() => openRate(item)}>
                Mark Watched
              </button>
              <button className="btn btn-outline" onClick={() => openNotInterested(item)}>
                Not Interested
              </button>
            </div>
          </div>
        ))
      )}
    </>
  );
}
