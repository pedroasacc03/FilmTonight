// POST /api/admin/backfill-posters - one-off migration action, triggered by
// the "Backfill posters" button on /admin/metrics (see lib/titles.js
// backfillMissingPosters for what it actually does and why it's needed:
// posters used to always be null, so any Title cached before that changed
// only picks one up naturally after a 30-day cache refresh otherwise).
// Admin-only, same gate as the metrics page itself.
import { NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/session";
import { isAdmin } from "@/lib/admin";
import { backfillMissingPosters } from "@/lib/titles";

export async function POST(request) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!isAdmin(user)) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }

  try {
    const result = await backfillMissingPosters();
    return NextResponse.json(result);
  } catch (err) {
    console.error("Poster backfill failed:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
