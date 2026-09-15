"use client";

import { useState } from "react";
import Link from "next/link";
import TitlePoster from "@/components/TitlePoster";
import TitleMeta from "@/components/TitleMeta";
import StreamingInfo from "@/components/StreamingInfo";
import Toast from "@/components/Toast";
import { useToast } from "@/lib/useToast";
import NotInterestedModal from "@/components/NotInterestedModal";
import RateModal from "@/components/RateModal";

const SOURCE_BADGES = {
  ai_new: { label: "New — never mentioned", className: "badge-new" },
  chatbot: { label: "From chat", className: "badge-chatbot" },
  surprise: { label: "Surprise Pick", className: "badge-surprise" },
};

export default function RecommendationsPageClient({ initialRecommendations, initialLocation, eligibility }) {
  const [recommendations, setRecommendations] = useState(initialRecommendations);
  const [generating, setGenerating] = useState(false);
  const [surprising, setSurprising] = useState(false);
  const [error, setError] = useState("");

  // Streaming availability differs by country - if we don't know the user's
  // region yet, ask before the first generation (see showRegionPrompt below).
  // `pendingAction` tracks which button triggered the prompt, so the right
  // one resumes once the region is saved.
  const [location, setLocation] = useState(initialLocation || "");
  const [showRegionPrompt, setShowRegionPrompt] = useState(false);
  const [pendingAction, setPendingAction] = useState(null); // "batch" | "surprise"
  const [regionInput, setRegionInput] = useState("");
  const [savingRegion, setSavingRegion] = useState(false);
  const [toast, showToast, dismissToast] = useToast();

  // "Not interested" asks for an optional reason first (see NotInterestedModal).
  const [notInterestedTarget, setNotInterestedTarget] = useState(null); // { id, title }
  const [notInterestedReason, setNotInterestedReason] = useState("");
  const [submittingNotInterested, setSubmittingNotInterested] = useState(false);

  // "Mark Watched" asks for a rating right away (see RateModal) instead of
  // just hoping the user comes back to the Watched page later.
  const [rateTarget, setRateTarget] = useState(null); // { id, title }
  const [rateStars, setRateStars] = useState(0);
  const [rateWhy, setRateWhy] = useState("");
  const [submittingRate, setSubmittingRate] = useState(false);

  async function refresh() {
    const res = await fetch("/api/recommendations");
    if (res.ok) {
      const data = await res.json();
      setRecommendations(data.recommendations || []);
    }
  }

  async function handleGenerate() {
    setGenerating(true);
    setError("");
    try {
      const res = await fetch("/api/recommendations", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not generate recommendations.");
      await refresh();
      const count = data.created?.length || 0;
      showToast(
        count > 0 ? `${count} new pick${count === 1 ? "" : "s"} generated!` : "Done!",
        count > 0 ? "Check them out below." : "No new picks this time - try rating a few more titles first."
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setGenerating(false);
    }
  }

  // "Surprise Me": exactly one deliberate stretch pick, grounded in a real
  // connecting thread to the user's taste (see lib/recommendations.js
  // generateSurprisePick) - a single cheap call, not a repeat of the batch.
  async function handleSurprise() {
    setSurprising(true);
    setError("");
    try {
      const res = await fetch("/api/recommendations/surprise", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not generate a surprise pick.");
      await refresh();
      showToast(`Found something different: "${data.created?.title?.name}"`, "See why below - give it a shot!");
    } catch (err) {
      setError(err.message);
    } finally {
      setSurprising(false);
    }
  }

  function handleGenerateClick() {
    if (!location) {
      setPendingAction("batch");
      setShowRegionPrompt(true);
      return;
    }
    handleGenerate();
  }

  function handleSurpriseClick() {
    if (!location) {
      setPendingAction("surprise");
      setShowRegionPrompt(true);
      return;
    }
    handleSurprise();
  }

  async function saveRegionAndGenerate(regionValue) {
    setSavingRegion(true);
    try {
      const res = await fetch("/api/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ location: regionValue }),
      });
      if (!res.ok) throw new Error("Could not save your region.");
      setLocation(regionValue);
      setShowRegionPrompt(false);
      setRegionInput("");
      if (pendingAction === "surprise") {
        await handleSurprise();
      } else {
        await handleGenerate();
      }
      setPendingAction(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingRegion(false);
    }
  }

  // `status` is a Recommendation-card action: "watched" | "wishlisted" | "not_interested".
  async function handleAction(recommendationId, status, { reason, stars, why } = {}) {
    const rec = recommendations.find((r) => r.id === recommendationId);
    // Optimistically remove it from the queue - once triaged, it belongs on
    // the Watched/Wishlist page instead, not here.
    setRecommendations((prev) => prev.filter((r) => r.id !== recommendationId));
    await fetch("/api/recommendations", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recommendationId, status, reason, stars, why }),
    });
    const name = rec?.title?.name || "Title";
    if (status === "watched") {
      showToast(
        stars ? `"${name}" rated and saved!` : `"${name}" marked as watched!`,
        stars ? "That sharpens your recommendations right away." : "You can rate it anytime from the Watched page."
      );
    } else if (status === "wishlisted") {
      showToast(`"${name}" added to your wishlist!`, "You can find it on the Wishlist page.");
    } else {
      showToast(`Got it - "${name}" marked not interested.`, "We won't recommend it again.");
    }
  }

  function openNotInterested(rec) {
    setNotInterestedReason("");
    setNotInterestedTarget(rec);
  }

  async function confirmNotInterested() {
    if (!notInterestedTarget) return;
    setSubmittingNotInterested(true);
    await handleAction(notInterestedTarget.id, "not_interested", { reason: notInterestedReason.trim() || undefined });
    setSubmittingNotInterested(false);
    setNotInterestedTarget(null);
  }

  function openRate(rec) {
    setRateStars(0);
    setRateWhy("");
    setRateTarget(rec);
  }

  async function confirmRate() {
    if (!rateTarget) return;
    setSubmittingRate(true);
    await handleAction(rateTarget.id, "watched", { stars: rateStars || undefined, why: rateWhy.trim() || undefined });
    setSubmittingRate(false);
    setRateTarget(null);
  }

  async function skipRate() {
    if (!rateTarget) return;
    const target = rateTarget;
    setRateTarget(null);
    await handleAction(target.id, "watched");
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

      {!eligibility.eligible && (
        <div className="card" style={{ background: "var(--color-accent-100)", borderColor: "var(--color-accent-300)" }}>
          <h3 style={{ marginTop: 0 }}>Recommendations unlock at {eligibility.goal} watched ratings</h3>
          <p className="muted" style={{ marginBottom: 12 }}>
            You&apos;re at {eligibility.watchedCount}/{eligibility.goal}. Rate a few more titles and this unlocks
            automatically ({eligibility.suggestedGoal} total is the sweet spot for even better picks, but it&apos;s
            not required).
          </p>
          <div className="progress-bar" style={{ marginBottom: 14 }}>
            <div
              className="progress-bar-fill"
              style={{ width: `${Math.min(100, Math.round((eligibility.watchedCount / eligibility.goal) * 100))}%` }}
            />
          </div>
          <Link href="/ratings" className="btn btn-primary">
            Go rate something
          </Link>
        </div>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: 10, marginBottom: 20 }}>
        <button
          className="btn btn-outline"
          onClick={handleSurpriseClick}
          disabled={generating || surprising || !eligibility.eligible}
        >
          {surprising ? "Thinking..." : "Surprise Me"}
        </button>
        <button
          className="btn btn-primary"
          onClick={handleGenerateClick}
          disabled={generating || surprising || !eligibility.eligible}
        >
          {generating ? "Thinking..." : "Generate more picks"}
        </button>
      </div>
      <p className="muted" style={{ marginTop: -14, marginBottom: 8 }}>
        &quot;Surprise Me&quot; picks one deliberate stretch outside your usual taste.
      </p>
      {eligibility.eligible && !eligibility.metSuggestedGoal && (
        <p className="muted" style={{ marginBottom: 20 }}>
          You&apos;ve rated {eligibility.watchedCount} titles - picks tend to get noticeably better by{" "}
          {eligibility.suggestedGoal}.
        </p>
      )}

      {error && <p className="error-text">{error}</p>}

      {showRegionPrompt && (
        <div className="modal-backdrop" onClick={() => !savingRegion && setShowRegionPrompt(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>What region are you in?</h3>
            <p className="muted" style={{ marginBottom: 16 }}>
              Streaming availability (Netflix, HBO Max, etc.) is different in every country. Telling us your region
              helps make sure the streaming info on your recommendations is actually accurate for you.
            </p>
            <label htmlFor="region-input">Your region</label>
            <input
              id="region-input"
              type="text"
              placeholder="e.g. Brazil, United Kingdom, Canada"
              value={regionInput}
              onChange={(e) => setRegionInput(e.target.value)}
              autoFocus
            />
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 4 }}>
              <button
                className="btn btn-primary"
                onClick={() => regionInput.trim() && saveRegionAndGenerate(regionInput.trim())}
                disabled={savingRegion || !regionInput.trim()}
              >
                {savingRegion ? "Saving..." : "Save & Generate"}
              </button>
              <button
                className="btn btn-outline"
                onClick={() => saveRegionAndGenerate("United States")}
                disabled={savingRegion}
              >
                No thanks, use US
              </button>
            </div>
          </div>
        </div>
      )}

      {recommendations.length === 0 ? (
        <p className="muted">
          Nothing here yet. Rate a few titles on the Ratings page so the AI has something to work with, then
          click &quot;Generate more picks&quot;.
        </p>
      ) : (
        recommendations.map((rec) => {
          const badge = SOURCE_BADGES[rec.source] || SOURCE_BADGES.ai_new;
          return (
            <div key={rec.id} className="rec-card">
              <div className="poster">
                <TitlePoster title={rec.title} />
              </div>
              <div className="body">
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <h3 style={{ margin: 0 }}>
                    {rec.title.name} {rec.title.year ? `(${rec.title.year})` : ""}
                  </h3>
                  <span className={`badge ${badge.className}`}>{badge.label}</span>
                </div>
                <TitleMeta title={rec.title} />
                <p className="muted">{rec.title.genres?.join(" · ") || "Genre unknown"}</p>
                <StreamingInfo title={rec.title} userRegion={location} />
                {rec.reasonText && (
                  <div className="why">
                    <strong>Why you&apos;ll like it: </strong>
                    {rec.reasonText}
                  </div>
                )}
              </div>
              <div className="actions">
                <button className="btn btn-primary" onClick={() => handleAction(rec.id, "wishlisted")}>
                  Add to Wishlist
                </button>
                <button className="btn btn-success" onClick={() => openRate(rec)}>
                  Mark Watched
                </button>
                <button className="btn btn-outline" onClick={() => openNotInterested(rec)}>
                  Not Interested
                </button>
              </div>
            </div>
          );
        })
      )}
    </>
  );
}
