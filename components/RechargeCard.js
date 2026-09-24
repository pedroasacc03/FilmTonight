"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Recharge (see lib/energy.js purchaseRecharge) is available on every tier,
// unlike the beta-Pro upgrade above it - and, same as beta Pro, it's fake
// today (no real Stripe charge - see that function's comment). Shows the
// real price ($1.99) struck through next to "Free" rather than hiding it,
// so it reads the same honest way beta Pro does: this is what it costs
// later, not what it costs today.
export default function RechargeCard({ energyAmount, priceUsd }) {
  const router = useRouter();
  const [stage, setStage] = useState("idle"); // "idle" | "recharging" | "recharged"
  const [error, setError] = useState("");

  async function handleRecharge() {
    setStage("recharging");
    setError("");
    try {
      const res = await fetch("/api/energy/recharge", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not process that right now.");
      setStage("recharged");
      window.dispatchEvent(new Event("energy:refresh"));
      router.refresh();
    } catch (err) {
      setError(err.message);
      setStage("idle");
    }
  }

  return (
    <div className="card" style={{ marginBottom: 32 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          flexWrap: "wrap",
          gap: 16,
          marginBottom: 16,
        }}
      >
        <div style={{ maxWidth: 400 }}>
          <h3 style={{ marginTop: 0, marginBottom: 4 }}>Need more today? Recharge</h3>
          <p className="muted" style={{ marginBottom: 0 }}>
            +{energyAmount} energy, instantly - stacks on what you already have, never expires, and works on every
            plan.
          </p>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontSize: 28, fontFamily: "var(--font-heading)", fontWeight: "var(--font-heading-weight)" }}>
            <span style={{ textDecoration: "line-through", opacity: 0.5, fontSize: 16, marginRight: 8 }}>
              ${priceUsd.toFixed(2)}
            </span>
            Free
          </div>
          <span className="chip chip-neutral" style={{ fontSize: 12 }}>
            Free right now - beta
          </span>
        </div>
      </div>

      {stage === "recharged" ? (
        <p className="muted" style={{ margin: 0 }}>
          +{energyAmount} energy added - ready to use right now.
        </p>
      ) : (
        <>
          {error && <p className="error-text">{error}</p>}
          <button className="btn btn-outline" onClick={handleRecharge} disabled={stage === "recharging"}>
            {stage === "recharging" ? "Adding..." : `Get +${energyAmount} energy free`}
          </button>
        </>
      )}
    </div>
  );
}
