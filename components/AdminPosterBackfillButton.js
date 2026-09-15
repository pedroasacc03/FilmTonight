"use client";

import { useState } from "react";

// One-off migration button for the "Title data health" admin card - see
// lib/titles.js backfillMissingPosters for what it does. Processes up to
// 100 titles per click (the route's own cap, to stay under a request
// timeout), so a database with more than that missing may need a few clicks.
export default function AdminPosterBackfillButton() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  async function run() {
    setRunning(true);
    setError("");
    setResult(null);
    try {
      const res = await fetch("/api/admin/backfill-posters", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Backfill failed.");
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div style={{ marginTop: 12 }}>
      <button className="btn btn-outline" onClick={run} disabled={running}>
        {running ? "Backfilling..." : "Backfill posters"}
      </button>
      {result && (
        <p className="muted" style={{ marginTop: 8 }}>
          Checked {result.checked}, updated {result.updated}.
          {result.moreRemain ? " More remain - click again to continue." : " Done - none left to backfill."}
        </p>
      )}
      {error && <p className="error-text" style={{ marginTop: 8 }}>{error}</p>}
    </div>
  );
}
