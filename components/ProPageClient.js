"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// The interactive half of app/pro/page.js: the billing-cycle toggle and the
// upgrade button, which calls the same lib/proGrant.js flow as the blocked-
// energy notification (see components/EnergyLimitWatcher.js), just with
// source: "pro_page_nav" instead of "blocked_notification".
export default function ProPageClient({ tier, slots, pricing, existingInterest, energyStatus }) {
  const router = useRouter();
  const [cycle, setCycle] = useState("monthly");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(
    existingInterest ? { granted: existingInterest.grantedBetaPro, waitlisted: !existingInterest.grantedBetaPro } : null
  );
  const [error, setError] = useState("");

  const alreadyPro = tier !== "free";

  async function handleUpgrade() {
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/pro/upgrade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: "pro_page_nav", billingCycleSelected: cycle }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not process that right now.");
      setResult(data);
      if (data.granted) {
        window.dispatchEvent(new Event("energy:refresh"));
        router.refresh();
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      {alreadyPro ? (
        <div className="card" style={{ background: "var(--color-accent-100)", borderColor: "var(--color-accent-300)" }}>
          <h3 style={{ marginTop: 0 }}>You&apos;re on Pro</h3>
          <p className="muted">
            {tier === "beta_pro"
              ? "Free during our beta - on us, while we finish rolling out billing. We'll email you before anything changes."
              : "Thanks for being a FilmTonight Pro subscriber."}
          </p>
        </div>
      ) : (
        <>
          <p className="muted" style={{ marginBottom: 24 }}>
            Free during beta - this is what it&apos;ll cost after. {slots.slotsRemaining} of {slots.maxSlots} free
            beta spots left.
          </p>

          {energyStatus && (
            <p className="muted" style={{ marginBottom: 20 }}>
              Free plan today: {energyStatus.energy}/{energyStatus.ceiling} energy remaining.
            </p>
          )}

          <div className="chip-row" style={{ marginBottom: 20 }}>
            <button
              type="button"
              className={`chip ${cycle === "monthly" ? "chip-neutral" : ""}`}
              onClick={() => setCycle("monthly")}
              style={cycle !== "monthly" ? { background: "transparent", borderColor: "var(--color-divider)" } : undefined}
            >
              Monthly - {pricing.monthly.label}
            </button>
            <button
              type="button"
              className={`chip ${cycle === "annual" ? "chip-neutral" : ""}`}
              onClick={() => setCycle("annual")}
              style={cycle !== "annual" ? { background: "transparent", borderColor: "var(--color-divider)" } : undefined}
            >
              Annual - {pricing.annual.label}
            </button>
          </div>

          {result ? (
            result.granted ? (
              <div className="card" style={{ background: "var(--color-accent-100)", borderColor: "var(--color-accent-300)" }}>
                <h3 style={{ marginTop: 0 }}>You&apos;re in!</h3>
                <p className="muted">
                  FilmTonight Pro is free during our beta - on us, while we finish rolling out billing. We&apos;ll
                  email you before anything changes.
                </p>
              </div>
            ) : (
              <div className="card">
                <h3 style={{ marginTop: 0 }}>You&apos;re on the waitlist</h3>
                <p className="muted">
                  All our free beta-Pro spots are claimed right now. We&apos;ll reach out if a spot opens up.
                </p>
              </div>
            )
          ) : (
            <>
              {error && <p className="error-text">{error}</p>}
              <button className="btn btn-primary" onClick={handleUpgrade} disabled={submitting}>
                {submitting ? "Setting up..." : slots.slotsRemaining > 0 ? "Unlock Pro free" : "Join the waitlist"}
              </button>
            </>
          )}
        </>
      )}
    </>
  );
}
