// The Watched page: every title the user has marked as "watched", with their
// star rating and their "why" comment - the same raw signal that feeds the
// AI Preference Analysis Engine. A Server Component fetches the list (same
// pattern as the Home page); WatchedPageClient handles in-place editing,
// since a title marked "watched" via a Recommendation card has no stars/why
// yet and this is the most direct place to add them.

import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { deserializeTitle } from "@/lib/titles";
import { trackPageView } from "@/lib/events";
import NavBar from "@/components/NavBar";
import WatchedPageClient from "@/components/WatchedPageClient";

export default async function WatchedPage() {
  const user = await requireUser();
  await trackPageView(user.id, "watched").catch((err) => console.error("Failed to track page view:", err.message));

  const ratings = await prisma.rating.findMany({
    where: { userId: user.id, status: "watched" },
    include: { title: true },
    orderBy: { updatedAt: "desc" },
  });

  const watched = ratings.map((r) => ({
    id: r.id,
    stars: r.stars,
    why: r.why,
    title: deserializeTitle(r.title),
  }));

  return (
    <>
      <NavBar activePath="/watched" />
      <div className="page">
        <h1>Watched</h1>
        <p className="muted" style={{ marginBottom: 24 }}>
          Every title you&apos;ve rated as watched, with your rating and your comments. Click the stars to rate or
          re-rate a title - the more of these are filled in, the better FilmTonight knows your taste and the
          sharper your recommendations get.
        </p>
        <WatchedPageClient initialWatched={watched} />
      </div>
    </>
  );
}
