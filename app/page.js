// The root route ("/") - the site's front door. Signed-in visitors get sent
// straight to /home (handled inside LandingPage below); everyone else sees
// the marketing landing page.

import LandingPage from "@/components/LandingPage";

// Forced dynamic: LandingPage does a per-request auth check (redirect a
// signed-in visitor straight to /home), which needs to run per-request, not
// be baked into a static build.
export const dynamic = "force-dynamic";

export default function RootPage() {
  return <LandingPage />;
}
