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
          <h3 style={{ marginTop: 0 }}>You&apos;re on {tier === "beta_pro" ? "beta Pro" : "Pro"}</h3>
          <p className="muted">
            {tier === "beta_pro"
              ? `${energyStatus?.ceiling ?? 8} actions a day, completely free - there's no real Pro subscription to buy yet, so this free access is what "Pro" means right now.`
              : "Thanks for being a FilmTonight Pro subscriber."}
          </p>
        </div>
      ) : (
        <>
          <p className="muted" style={{ marginBottom: 16 }}>
            {slots.slotsRemaining} of {slots.maxSlots} free beta spots left.
          </p>

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
                  You now have beta Pro - {result.ceiling ?? 8} actions a day, completely free. There&apos;s no real
                  Pro subscription to buy yet, so this free access is what &quot;Pro&quot; means right now, and
                  there&apos;s nothing automatic that expires or revokes it.
                </p>
              </div>
            ) : (
              <div className="card">
                <h3 style={{ marginTop: 0 }}>You&apos;re on the waitlist</h3>
                <p className="muted">
                  All our free beta-Pro spots are claimed right now. Check back on this page anytime to see if a
                  spot has opened up.
                </p>
              </div>
            )
          ) : (
            <>
              {error && <p className="error-text">{error}</p>}
              <button className="btn btn-primary" onClick={handleUpgrade} disabled={submitting}>
                {submitting ? "Setting up..." : slots.slotsRemaining > 0 ? "Unlock beta Pro free" : "Join the waitlist"}
              </button>
              {energyStatus && (
                <p className="muted" style={{ marginTop: 12, fontSize: 12 }}>
                  {/* energy can exceed ceiling after a Recharge purchase (it
                      stacks and never expires) - "12/4" would read as a bug. */}
                  Free plan today: {energyStatus.energy}
                  {energyStatus.energy <= energyStatus.ceiling ? `/${energyStatus.ceiling}` : " (includes a Recharge top-up)"}{" "}
                  energy remaining.
                </p>
              )}
            </>
          )}
        </>
      )}
    </>
  );
}
