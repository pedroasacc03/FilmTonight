"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

// Centralizes handling of the ENERGY_LIMIT_REACHED 429 (see lib/energy.js)
// in exactly one place: a global fetch interceptor, mounted once from
// app/layout.js, rather than per-component try/catch logic scattered across
// every page that calls a metered endpoint (recommendations, chat,
// Surprise Me). Every fetch anywhere in the app passes through here.
//
// Deliberately built on the app's existing .modal-backdrop/.modal-box
// pattern (see RateModal, NotInterestedModal) rather than the lighter
// <Toast> component - a blocked energy limit is a bigger deal than a
// routine "Saved!" confirmation, and the modal styling (plus
// .energy-limit-modal's amber glow - see app/globals.css) is what makes it
// read as weightier.
const DISMISS_COOLDOWN_MS = 3000;

// Exported so the metered-action page components (ChatPageClient,
// RecommendationsPageClient) can recognize this one machine-readable code
// and skip setting their own inline "error" text for it - the modal below
// already communicates it, so showing both would be redundant/confusing.
// Everything else about handling this error stays centralized here.
export const ENERGY_LIMIT_ERROR_CODE = "ENERGY_LIMIT_REACHED";

export default function EnergyLimitWatcher() {
  const router = useRouter();
  const [blocked, setBlocked] = useState(null); // { tier, action, energyRemaining, resetAt, ceiling } | null
  // The real daily ceiling for whoever just got granted beta Pro - only
  // known once the grant response comes back (see handleUpgradeClick),
  // since `blocked.ceiling` still reflects the tier they were on *before*
  // granting (their old, lower ceiling), not what they have now.
  const [grantedCeiling, setGrantedCeiling] = useState(null);
  // "blocked" | "granting" | "granted" | "waitlisted" | "recharging" | "recharged"
  const [stage, setStage] = useState("blocked");
  const isOpenRef = useRef(false);
  const lastDismissedAtRef = useRef(0);

  useEffect(() => {
    isOpenRef.current = !!blocked;
  }, [blocked]);

  useEffect(() => {
    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
      const res = await originalFetch(...args);
      if (res.status === 429) {
        // Debounce: while the modal's already open, or within a few
        // seconds of being dismissed, ignore further triggers - mashing a
        // blocked button before its disabled state kicks in can fire
        // several 429s back to back, and none of them should spawn a
        // second modal.
        const debounced = isOpenRef.current || Date.now() - lastDismissedAtRef.current < DISMISS_COOLDOWN_MS;
        if (!debounced) {
          res
            .clone()
            .json()
            .then((data) => {
              if (data?.error === "ENERGY_LIMIT_REACHED") {
                setStage("blocked");
                setBlocked(data);
              }
            })
            .catch(() => {
              // Not our error shape (or not JSON) - a normal 429 from
              // somewhere else, nothing to show.
            });
        }
      }
      return res;
    };
    return () => {
      window.fetch = originalFetch;
    };
  }, []);

  const dismiss = useCallback(() => {
    setBlocked(null);
    lastDismissedAtRef.current = Date.now();
  }, []);

  useEffect(() => {
    if (!blocked) return;
    function onKeyDown(e) {
      if (e.key === "Escape") dismiss();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [blocked, dismiss]);

  async function handleUpgradeClick() {
    setStage("granting");
    try {
      const res = await fetch("/api/pro/upgrade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: "blocked_notification", billingCycleSelected: "monthly" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not process that.");
      setGrantedCeiling(data.ceiling);
      setStage(data.granted ? "granted" : "waitlisted");
      if (data.granted) {
        // Tells NavBar (which fetches its own energy/tier status on mount)
        // to refresh right away, and re-runs server components so the rest
        // of the app picks up the new tier without a full reload.
        window.dispatchEvent(new Event("energy:refresh"));
        router.refresh();
      }
    } catch {
      setStage("blocked"); // fall back to the original choice - try again or dismiss
    }
  }

  // Recharge (see lib/energy.js purchaseRecharge) - available to every
  // tier, unlike the beta-Pro grant above which only makes sense for free.
  async function handleRechargeClick() {
    setStage("recharging");
    try {
      const res = await fetch("/api/energy/recharge", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not process that.");
      setStage("recharged");
      window.dispatchEvent(new Event("energy:refresh"));
      router.refresh();
    } catch {
      setStage("blocked");
    }
  }

  if (!blocked) return null;
  const isFree = blocked.tier === "free";

  return (
    <div className="modal-backdrop" onClick={stage === "blocked" ? dismiss : undefined}>
      <div
        className="modal-box energy-limit-modal"
        role="alertdialog"
        aria-live="assertive"
        aria-modal="true"
        aria-label={isFree ? "Out of energy for today" : "Daily fair-use limit reached"}
        onClick={(e) => e.stopPropagation()}
      >
        {stage === "blocked" && (
          <>
            <h3 style={{ marginTop: 0 }}>{isFree ? "Out of energy for today" : "Fair-use limit reached"}</h3>
            <p style={{ marginBottom: 20 }}>
              {isFree
                ? "You're out of energy for today — it resets at midnight. There's no real Pro subscription to buy yet, but you can unlock beta Pro free while spots last."
                : `You've used all ${blocked.ceiling} of today's actions — it resets at midnight UTC.`}
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              {isFree && (
                <button className="btn btn-primary" onClick={handleUpgradeClick}>
                  Unlock beta Pro free
                </button>
              )}
              <button className="btn btn-outline" onClick={handleRechargeClick}>
                Get +20 energy free
              </button>
              <button className="btn btn-outline" onClick={dismiss} autoFocus>
                {isFree ? "Wait until tomorrow" : "Got it"}
              </button>
            </div>
          </>
        )}

        {stage === "granting" && <p style={{ margin: 0 }}>Setting up your beta Pro access...</p>}

        {stage === "recharging" && <p style={{ margin: 0 }}>Adding your energy...</p>}

        {stage === "recharged" && (
          <>
            <h3 style={{ marginTop: 0 }}>+20 energy added</h3>
            <p style={{ marginBottom: 20 }}>
              It&apos;s ready to use right now, stacked on top of what you already had - it won&apos;t expire at
              midnight. Recharge is free during beta (normally $1.99), so you weren&apos;t charged anything.
            </p>
            <button className="btn btn-primary" onClick={dismiss} autoFocus>
              Let&apos;s go
            </button>
          </>
        )}

        {stage === "granted" && (
          <>
            <h3 style={{ marginTop: 0 }}>You&apos;re in!</h3>
            <p style={{ marginBottom: 20 }}>
              You now have beta Pro — {grantedCeiling ?? 8} actions a day (recommendation batches, chat messages,
              and Surprise Me picks combined), completely free. There&apos;s no real Pro subscription to buy yet -
              this free access is what &quot;Pro&quot; means right now, and there&apos;s nothing automatic that
              expires or revokes it.
            </p>
            <button className="btn btn-primary" onClick={dismiss} autoFocus>
              Let&apos;s go
            </button>
          </>
        )}

        {stage === "waitlisted" && (
          <>
            <h3 style={{ marginTop: 0 }}>You&apos;re on the list</h3>
            <p style={{ marginBottom: 20 }}>
              All our free beta-Pro spots are claimed right now. You&apos;re on the waitlist - check back on the{" "}
              <a href="/pro">Pro page</a> anytime to see if a spot has opened up.
            </p>
            <button className="btn btn-outline" onClick={dismiss} autoFocus>
              Got it
            </button>
          </>
        )}
      </div>
    </div>
  );
}
