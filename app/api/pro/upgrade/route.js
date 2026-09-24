// POST /api/pro/upgrade - the beta-Pro grant flow. Called from the blocked-
// energy notification's primary button and from the /pro page's upgrade
// button. See lib/proGrant.js for the actual (fake, no-Stripe) grant logic
// and its idempotency guarantee.
import { NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/session";
import { createProUpgradeIntent } from "@/lib/proGrant";

const VALID_SOURCES = ["blocked_notification", "pro_page_nav"];
const VALID_CYCLES = ["monthly", "annual"];

export async function POST(request) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const body = await request.json().catch(() => null);
  const source = VALID_SOURCES.includes(body?.source) ? body.source : "pro_page_nav";
  const billingCycleSelected = VALID_CYCLES.includes(body?.billingCycleSelected) ? body.billingCycleSelected : "monthly";

  try {
    // Real account email, not client-supplied - there's no separate email
    // capture step in this flow, and the account's own email is the only
    // one that makes sense to record here anyway.
    const result = await createProUpgradeIntent({ userId: user.id, email: user.email, source, billingCycleSelected });
    return NextResponse.json(result);
  } catch (err) {
    console.error("Failed to process beta-Pro upgrade intent:", err);
    return NextResponse.json({ error: "Could not process that right now - try again." }, { status: 500 });
  }
}
