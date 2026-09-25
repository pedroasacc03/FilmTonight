"use client";

import { useState } from "react";

// One-off migration button for the "Energy system" admin card - see
// lib/energy.js backfillStaleEnergyCeilings for what it does and why it's
// needed (refillIfStale only ever refills up, never down, so a balance
// banked before FREE_DAILY_ENERGY was tightened from 6 to 4 just sits at
// the old number forever otherwise, on any account that had it).
export default function AdminEnergyBackfillButton() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  async function run() {
    setRunning(true);
    setError("");
    setResult(null);
    try {
      const res = await fetch("/api/admin/backfill-energy-ceiling", { method: "POST" });
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
        {running ? "Fixing..." : "Fix stale energy balances"}
      </button>
      {result && (
        <p className="muted" style={{ marginTop: 8 }}>
          Checked {result.checked}, corrected {result.corrected}.
        </p>
      )}
      {error && (
        <p className="error-text" style={{ marginTop: 8 }}>
          {error}
        </p>
      )}
    </div>
  );
}
