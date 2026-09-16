// The marketing landing page's markup and behavior, rendered at "/" (the
// site's front door - what a brand-new visitor sees before login/register).
// This used to be one of 3 A/B-tested pitch variants (see git history for
// lib/landingVariants.js and app/lp/[variant]) - simplified down to just
// this one ("pain-led": the decision-fatigue angle) once there was no
// longer a real need to keep testing multiple pitches against each other.

import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";

export default async function LandingPage() {
  // A signed-in visitor doesn't need the pitch - send them straight in.
  const user = await getCurrentUser();
  if (user) redirect("/home");

  return (
    <div>
      <div className="landing-nav">
        <span className="brand">CineMatch</span>
        <Link href="/login">Log in</Link>
      </div>

      <div className="landing-hero">
        <h1>Stop wasting 5 days a year deciding what to watch.</h1>
        <p>
          Just 20 minutes a day spent browsing adds up to 5 days a year, gone. CineMatch narrows it down to a
          handful of picks that actually fit you, in seconds.
        </p>
        <div className="landing-cta-row">
          <Link href="/register" className="btn btn-primary">
            Get started free
          </Link>
          <Link href="/login" className="btn btn-outline">
            Log in
          </Link>
        </div>
      </div>

      <div className="landing-section">
        <h2>How it works</h2>
        <div className="landing-steps">
          <div className="landing-step">
            <div className="landing-step-number">1</div>
            <h3>Rate what you&apos;ve watched</h3>
            <p className="muted">
              A star rating and a quick &quot;why&quot; - the more you rate, the better CineMatch knows you.
            </p>
          </div>
          <div className="landing-step">
            <div className="landing-step-number">2</div>
            <h3>AI builds your taste profile</h3>
            <p className="muted">
              Genres, themes, favorite creators, even your contradictions - fully visible and editable, and it
              keeps getting sharper with every title you rate.
            </p>
          </div>
          <div className="landing-step">
            <div className="landing-step-number">3</div>
            <h3>Get picks that actually fit</h3>
            <p className="muted">Personalized recommendations with a plain-English reason for each one.</p>
          </div>
        </div>
      </div>

      <div className="landing-section">
        <h2>What you get</h2>
        <div className="landing-feature-grid">
          <div className="landing-feature-card">
            <h3>A taste profile you can read</h3>
            <p className="muted">Not a black box - see exactly what the AI thinks you like, and correct it anytime.</p>
          </div>
          <div className="landing-feature-card">
            <h3>Surprise Me</h3>
            <p className="muted">
              One deliberate stretch pick outside your comfort zone, with a real reason it might work for you.
            </p>
          </div>
          <div className="landing-feature-card">
            <h3>Streaming availability</h3>
            <p className="muted">Region-aware, so you know where to actually watch a pick before you commit.</p>
          </div>
          <div className="landing-feature-card">
            <h3>Ask, don&apos;t scroll</h3>
            <p className="muted">Tell the chatbot your mood and get a pick on the spot.</p>
          </div>
        </div>
      </div>

      <div className="landing-cta-section">
        <h2>Stop wasting 5 days a year deciding what to watch.</h2>
        <Link href="/register" className="btn btn-primary">
          Get started free
        </Link>
      </div>

      <div className="landing-footer">
        <Link href="/privacy">Privacy Policy</Link> · <Link href="/terms">Terms of Service</Link>
      </div>
    </div>
  );
}
