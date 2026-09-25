"use client";

import { useState } from "react";
import { COMMON_STREAMING_SERVICES, RATINGS_GOAL, RECOMMENDED_RATINGS_GOAL } from "@/lib/questions";
import Toast from "@/components/Toast";
import { useToast } from "@/lib/useToast";

// Small reusable chip editor: shows a list of removable chips plus an
// "+ Add" input. Used for likes/dislikes, streaming services, and languages.
// `onAdd` (optional) fires only for the add action - not removals - so the
// caller can show a confirmation without also firing one on every remove.
function ChipEditor({ items, onChange, onAdd, chipClassName, placeholder }) {
  const [draft, setDraft] = useState("");

  function addItem() {
    const value = draft.trim();
    if (!value || items.includes(value)) return;
    onChange([...items, value]);
    onAdd?.(value);
    setDraft("");
  }

  function removeItem(item) {
    onChange(items.filter((i) => i !== item));
  }

  return (
    <div className="chip-row">
      {items.map((item) => (
        <button key={item} className={`chip ${chipClassName}`} onClick={() => removeItem(item)} title="Click to remove">
          {item} <span>x</span>
        </button>
      ))}
      <input
        type="text"
        placeholder={placeholder || "+ Add"}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            addItem();
          }
        }}
        style={{ width: 160, margin: 0, padding: "5px 12px", borderRadius: 14, fontSize: 13 }}
      />
      <button className="chip chip-add" onClick={addItem}>
        + Add
      </button>
    </div>
  );
}

// Editable list of free-text notes (storytelling preferences, themes, nuances).
// `onAdd` (optional) fires only for the add action, same reasoning as ChipEditor.
function ListEditor({ items, onChange, onAdd }) {
  const [draft, setDraft] = useState("");

  function updateItem(index, value) {
    const next = [...items];
    next[index] = value;
    onChange(next);
  }

  function removeItem(index) {
    onChange(items.filter((_, i) => i !== index));
  }

  function addItem() {
    if (!draft.trim()) return;
    onChange([...items, draft.trim()]);
    onAdd?.(draft.trim());
    setDraft("");
  }

  return (
    <div>
      {items.map((item, i) => (
        <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <input
            type="text"
            value={item}
            onChange={(e) => updateItem(i, e.target.value)}
            style={{ marginBottom: 0, flex: 1 }}
          />
          <button className="btn btn-danger-outline" onClick={() => removeItem(i)}>
            Remove
          </button>
        </div>
      ))}
      <div style={{ display: "flex", gap: 8 }}>
        <input
          type="text"
          placeholder="Add a note..."
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          style={{ marginBottom: 0, flex: 1 }}
        />
        <button className="btn btn-outline" onClick={addItem}>
          + Add
        </button>
      </div>
    </div>
  );
}

// Genre list with a 1-5 dot confidence indicator per genre.
// `onAdd` (optional) fires only for the add action, same reasoning as ChipEditor.
function GenreEditor({ genres, onChange, onAdd }) {
  const [draft, setDraft] = useState("");

  function setConfidence(index, confidence) {
    const next = genres.map((g, i) => (i === index ? { ...g, confidence } : g));
    onChange(next);
  }

  function removeGenre(index) {
    onChange(genres.filter((_, i) => i !== index));
  }

  function addGenre() {
    if (!draft.trim()) return;
    onChange([...genres, { name: draft.trim(), confidence: 3 }]);
    onAdd?.(draft.trim());
    setDraft("");
  }

  return (
    <div>
      {genres.map((g, i) => (
        <div key={g.name + i} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, marginBottom: 10 }}>
          <span style={{ flex: "1 1 140px" }}>{g.name}</span>
          <span className="dot-rating">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                className={`dot ${n <= g.confidence ? "filled" : ""}`}
                onClick={() => setConfidence(i, n)}
              />
            ))}
          </span>
          <button className="btn btn-danger-outline" style={{ padding: "4px 10px" }} onClick={() => removeGenre(i)}>
            Remove
          </button>
        </div>
      ))}
      <div style={{ display: "flex", gap: 8, maxWidth: 340 }}>
        <input
          type="text"
          placeholder="Add a genre..."
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          style={{ marginBottom: 0, flex: 1 }}
        />
        <button className="btn btn-outline" onClick={addGenre}>
          + Add
        </button>
      </div>
    </div>
  );
}

export default function PreferencesPageClient({ initialProfile, initialUserMeta }) {
  const [profile, setProfile] = useState(
    initialProfile || {
      generalLikes: [],
      generalDislikes: [],
      genres: [],
      storytelling: [],
      languages: [],
      demographicsConsider: "",
      themes: [],
      nuances: [],
      favoriteCreators: [],
      viewingHabits: [],
      summary: "",
    }
  );
  const [userMeta, setUserMeta] = useState(initialUserMeta);
  const [saving, setSaving] = useState(false);
  const [toast, showToast, dismissToast] = useToast();

  // Sends a partial update to the server. `body` can mix profile fields
  // (generalLikes, genres, ...) and user fields (location, streamingServices,
  // openToOtherStreaming) - the API route sorts out which is which. Returns
  // whether the save succeeded, so callers can confirm before showing a toast.
  async function persist(body) {
    setSaving(true);
    try {
      const res = await fetch("/api/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok && data.profile) setProfile(data.profile);
      return res.ok;
    } finally {
      setSaving(false);
    }
  }

  function updateProfileField(field, value) {
    setProfile((prev) => ({ ...prev, [field]: value }));
    return persist({ [field]: value });
  }

  function updateUserField(field, value) {
    setUserMeta((prev) => ({ ...prev, [field]: value }));
    return persist({ [field]: value });
  }

  // Generic "added a chip/note/genre" confirmation used across the page.
  function confirmAdded(guidance) {
    showToast("Saved!", guidance);
  }

  const hasAnyData =
    profile.generalLikes?.length ||
    profile.genres?.length ||
    profile.storytelling?.length ||
    profile.themes?.length;

  return (
    <>
      {toast && <Toast key={toast.key} message={toast.message} guidance={toast.guidance} onDismiss={dismissToast} />}

      <div style={{ marginBottom: 16 }}>
        <p className="muted" style={{ maxWidth: 600 }}>
          Inspired by Instagram&apos;s &quot;Your Algorithm&quot; page — full transparency into what drives your
          recommendations. Edit anything below; changes are saved automatically and reshape your recommendations
          right away. This whole page is built from your ratings, so the more you rate on the{" "}
          <a href="/ratings">Ratings page</a>, the richer and more accurate everything here gets - your profile
          refreshes automatically as you rate, wishlist, or mark something not interested.
        </p>
      </div>

      {!hasAnyData && (
        <p className="muted" style={{ marginBottom: 20 }}>
          Not enough data yet — go rate at least {RATINGS_GOAL} titles (aim for {RECOMMENDED_RATINGS_GOAL} for a
          noticeably richer profile) on the <a href="/ratings">Ratings page</a>, then come back here.
        </p>
      )}

      {profile.summary && (
        <div className="card" style={{ background: "var(--color-accent-100)", borderColor: "var(--color-accent-300)" }}>
          <strong>Your ideal content formula: </strong>
          {profile.summary}
        </div>
      )}

      <div className="card">
        <h3>General — What You Like / Dislike</h3>
        <p className="muted">Drawn to:</p>
        <ChipEditor
          items={profile.generalLikes || []}
          onChange={(v) => updateProfileField("generalLikes", v)}
          onAdd={() => confirmAdded("This now shapes your recommendations.")}
          chipClassName="chip-like"
        />
        <p className="muted" style={{ marginTop: 14 }}>
          Avoids:
        </p>
        <ChipEditor
          items={profile.generalDislikes || []}
          onChange={(v) => updateProfileField("generalDislikes", v)}
          onAdd={() => confirmAdded("We'll steer away from this in recommendations.")}
          chipClassName="chip-dislike"
        />
      </div>

      <div className="card">
        <h3>Genre Preferences</h3>
        <GenreEditor
          genres={profile.genres || []}
          onChange={(v) => updateProfileField("genres", v)}
          onAdd={() => confirmAdded("This now shapes your recommendations.")}
        />
      </div>

      <div className="card">
        <h3>Favorite Directors / Creators / Actors</h3>
        <p className="muted">
          People whose work you seem drawn to - the AI adds someone here once they show up across two or more
          titles you rated highly. A new title from someone listed here is treated as a strong pick.
        </p>
        <ChipEditor
          items={profile.favoriteCreators || []}
          onChange={(v) => updateProfileField("favoriteCreators", v)}
          onAdd={() => confirmAdded("New titles from them will be prioritized in your recommendations.")}
          chipClassName="chip-neutral"
          placeholder="e.g. Christopher Nolan"
        />
      </div>

      <div className="card">
        <h3>Platform / Streaming Preferences</h3>
        <ChipEditor
          items={userMeta.streamingServices || []}
          onChange={(v) => updateUserField("streamingServices", v)}
          onAdd={() => confirmAdded("Recommendations will favor what's available there.")}
          chipClassName="chip-neutral"
          placeholder="e.g. Netflix"
        />
        <p className="muted" style={{ marginTop: 4 }}>
          Suggestions: {COMMON_STREAMING_SERVICES.join(", ")}
        </p>
        <label style={{ marginTop: 14 }}>
          <input
            type="checkbox"
            checked={!!userMeta.openToOtherStreaming}
            onChange={async (e) => {
              const checked = e.target.checked;
              const ok = await updateUserField("openToOtherStreaming", checked);
              if (ok) {
                showToast(
                  "Preference saved!",
                  checked
                    ? "We'll also suggest titles from other streaming services."
                    : "We'll stick to your listed streaming services."
                );
              }
            }}
            style={{ width: "auto", marginRight: 8 }}
          />
          Open to recommendations on other streaming services too
        </label>
      </div>

      <div className="card">
        <h3>Storytelling Preferences</h3>
        <ListEditor
          items={profile.storytelling || []}
          onChange={(v) => updateProfileField("storytelling", v)}
          onAdd={() => confirmAdded("Saved to your storytelling preferences.")}
        />
      </div>

      <div className="two-col">
        <div className="card">
          <h3>Language Preferences</h3>
          <ChipEditor
            items={profile.languages || []}
            onChange={(v) => updateProfileField("languages", v)}
            onAdd={() => confirmAdded("Saved to your language preferences.")}
            chipClassName="chip-neutral"
            placeholder="e.g. Korean"
          />
        </div>
        <div className="card">
          <h3>
            Demographics <span className="muted">(optional)</span>
          </h3>
          <label htmlFor="location">Your location</label>
          <input
            id="location"
            type="text"
            placeholder="e.g. São Paulo, Brazil"
            value={userMeta.location || ""}
            onChange={(e) => setUserMeta((prev) => ({ ...prev, location: e.target.value }))}
            onBlur={async (e) => {
              const value = e.target.value.trim();
              if (!value) return;
              const ok = await updateUserField("location", value);
              if (ok) showToast("Location saved!", "Streaming availability will reflect this region.");
            }}
          />
          <label htmlFor="consider">Also consider content from</label>
          <input
            id="consider"
            type="text"
            placeholder="e.g. also open to Japanese and Korean productions"
            value={profile.demographicsConsider || ""}
            onChange={(e) => setProfile((prev) => ({ ...prev, demographicsConsider: e.target.value }))}
            onBlur={async (e) => {
              const value = e.target.value.trim();
              if (!value) return;
              const ok = await updateProfileField("demographicsConsider", value);
              if (ok) showToast("Preference saved!", "We'll factor this into your recommendations.");
            }}
          />
          <p className="muted">Used only to weigh a title&apos;s country of origin — never required.</p>
        </div>
      </div>

      <div className="two-col">
        <div className="card">
          <h3>Recurring Themes</h3>
          <ListEditor
            items={profile.themes || []}
            onChange={(v) => updateProfileField("themes", v)}
            onAdd={() => confirmAdded("Saved to your recurring themes.")}
          />
        </div>
        <div className="card">
          <h3>Taste Nuances</h3>
          <ListEditor
            items={profile.nuances || []}
            onChange={(v) => updateProfileField("nuances", v)}
            onAdd={() => confirmAdded("Saved to your taste nuances.")}
          />
        </div>
      </div>

      <div className="card">
        <h3>Viewing Habits</h3>
        <p className="muted">
          Patterns the AI noticed around runtime/length comfort, how much critical scores (RT/IMDb) seem to matter
          to you, recent vs. classic era preference, content-rating/maturity comfort, and ongoing vs. ended shows.
        </p>
        <ListEditor
          items={profile.viewingHabits || []}
          onChange={(v) => updateProfileField("viewingHabits", v)}
          onAdd={() => confirmAdded("Saved to your viewing habits.")}
        />
      </div>

      {saving && <p className="muted">Saving...</p>}
    </>
  );
}
