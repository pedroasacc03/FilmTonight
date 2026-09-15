"use client";

import { useState } from "react";
import StarRating from "@/components/StarRating";
import TitlePoster from "@/components/TitlePoster";
import TitleMeta from "@/components/TitleMeta";
import Toast from "@/components/Toast";
import { useToast } from "@/lib/useToast";

// One row's local edit state, keyed by rating id, so typing in one title's
// "why" box doesn't touch any other row. The toast lives on the parent (see
// below) since multiple rows can be on screen at once and a fixed-position
// toast rendered per-row would overlap.
function WatchedRow({ item, onSaved, onRequestDelete }) {
  const [stars, setStars] = useState(item.stars || 0);
  const [why, setWhy] = useState(item.why || "");
  const [savedStars, setSavedStars] = useState(item.stars || 0);
  const [savedWhy, setSavedWhy] = useState(item.why || "");
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");

  const dirty = stars !== savedStars || why !== savedWhy;

  async function handleSave() {
    setSaving(true);
    setSaveMessage("");
    try {
      const res = await fetch("/api/ratings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          titleId: item.title.id,
          status: "watched",
          stars: stars || null,
          why: why || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save rating.");
      setSavedStars(stars);
      setSavedWhy(why);
      onSaved(item.title.name);
    } catch (err) {
      setSaveMessage(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rec-card">
      <div className="poster">
        <TitlePoster title={item.title} />
      </div>
      <div className="body">
        <h3 style={{ margin: "0 0 4px" }}>
          {item.title.name} {item.title.year ? `(${item.title.year})` : ""}
        </h3>
        <TitleMeta title={item.title} />
        <p className="muted" style={{ margin: "0 0 8px" }}>
          {item.title.genres?.join(" / ") || "Genres unknown"}
        </p>
        {!item.stars && (
          <p className="muted" style={{ color: "var(--color-danger-700)", marginBottom: 6 }}>
            <strong>Not yet rated</strong> - add stars below so this counts toward your taste profile.
          </p>
        )}
        <div style={{ marginBottom: 10 }}>
          <StarRating value={stars} onChange={setStars} />
        </div>
        <label htmlFor={`why-${item.id}`}>
          Why? (optional - the more specific, the better the AI understands your taste)
        </label>
        <textarea
          id={`why-${item.id}`}
          rows={2}
          value={why}
          onChange={(e) => setWhy(e.target.value)}
          placeholder="e.g. The slow-burn tension and morally grey characters got me - the ambiguous ending fit the tone perfectly."
        />
        {dirty && (
          <button className="btn btn-success" onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </button>
        )}
        {saveMessage && <p className="error-text" style={{ marginTop: 8 }}>{saveMessage}</p>}
      </div>
      <div className="actions">
        <button className="btn btn-danger-outline" onClick={() => onRequestDelete(item)}>
          Delete
        </button>
      </div>
    </div>
  );
}

export default function WatchedPageClient({ initialWatched }) {
  const [watched, setWatched] = useState(initialWatched);
  const [toast, showToast, dismissToast] = useToast();

  // "Delete" asks for confirmation first, same reasoning as NotInterestedModal
  // elsewhere - it's a destructive action (removes the title from the AI
  // Engine's signal entirely, not just a status change), so it shouldn't be
  // one accidental click.
  const [deleteTarget, setDeleteTarget] = useState(null); // watched item pending confirmation
  const [deleting, setDeleting] = useState(false);

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch("/api/ratings", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ratingId: deleteTarget.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not delete rating.");
      setWatched((prev) => prev.filter((w) => w.id !== deleteTarget.id));
      showToast(`"${deleteTarget.title.name}" removed from Watched.`, "It no longer counts toward your taste profile.");
    } catch (err) {
      showToast(err.message);
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  }

  if (watched.length === 0) {
    return (
      <p className="muted">
        Nothing watched yet — head to the <a href="/ratings">Ratings page</a> and rate a title.
      </p>
    );
  }

  // Titles marked "watched" from the Wishlist/Recommendations pages don't
  // collect a star rating in the moment (that flow is one click, on
  // purpose) - so they land here unrated. Surfacing the count is the nudge
  // to circle back, since an unrated "watched" entry gives the AI almost
  // nothing to work with compared to one with stars and a "why".
  const unratedCount = watched.filter((w) => !w.stars).length;

  return (
    <>
      {toast && <Toast key={toast.key} message={toast.message} guidance={toast.guidance} onDismiss={dismissToast} />}

      {unratedCount > 0 && (
        <div className="card" style={{ background: "var(--color-accent-100)", borderColor: "var(--color-accent-300)" }}>
          <strong>
            {unratedCount} title{unratedCount === 1 ? "" : "s"} still need{unratedCount === 1 ? "s" : ""} a star
            rating
          </strong>
          <p className="muted" style={{ margin: "4px 0 0" }}>
            These are marked watched but have no rating yet, so they&apos;re barely helping your recommendations.
            Scroll down and add stars (and a quick &quot;why&quot;, if you remember) to get full value from them.
          </p>
        </div>
      )}

      {deleteTarget && (
        <div className="modal-backdrop" onClick={() => !deleting && setDeleteTarget(null)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>Delete &quot;{deleteTarget.title.name}&quot;?</h3>
            <p className="muted" style={{ marginBottom: 16 }}>
              This removes it from your Watched list entirely, including its rating and notes. The AI will no
              longer use it to shape your recommendations. This can&apos;t be undone.
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              <button className="btn btn-danger-outline" onClick={confirmDelete} disabled={deleting}>
                {deleting ? "Deleting..." : "Delete"}
              </button>
              <button className="btn btn-outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {watched.map((item) => (
        <WatchedRow
          key={item.id}
          item={item}
          onSaved={(titleName) =>
            showToast(`"${titleName}" updated!`, "Saved - this sharpens your recommendations right away.")
          }
          onRequestDelete={setDeleteTarget}
        />
      ))}
    </>
  );
}
