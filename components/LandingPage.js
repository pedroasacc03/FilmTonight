// The marketing landing page's markup and behavior, rendered at "/" (the
// site's front door - what a brand-new visitor sees before login/register).
// Uses the .brand-dark theme (app/globals.css) - FilmTonight's navy/amber
// palette, per the Brand Foundation Brief - scoped to this page and the
// login/register flow only, not the rest of the (still light-themed) app.

import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { TAGLINE } from "@/lib/brand";

export default async function LandingPage() {
  // A signed-in visitor doesn't need the pitch - send them straight in.
  const user = await getCurrentUser();
  if (user) redirect("/home");

  return (
    <div className="brand-dark">
      <div className="landing-nav">
        <span className="brand">FilmTonight</span>
        <Link href="/login">Log in</Link>
      </div>

      <div className="landing-hero">
        <p className="landing-kicker">{TAGLINE}</p>
        <h1>Stop wasting 5 days a year deciding what to watch.</h1>
        <p>
          Twenty minutes of scrolling tonight is twenty minutes you won&apos;t get back. FilmTonight narrows it
          down to a handful of picks that actually fit you - so you can just press play.
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
              A star rating and a quick &quot;why&quot; - the more you share, the better FilmTonight gets at
              picking for you.
            </p>
          </div>
          <div className="landing-step">
            <div className="landing-step-number">2</div>
            <h3>We learn what you love</h3>
            <p className="muted">
              Genres, themes, favorite creators, even your contradictions - fully visible and editable, and it
              keeps getting sharper the more you rate.
            </p>
          </div>
          <div className="landing-step">
            <div className="landing-step-number">3</div>
            <h3>Get picks that actually fit</h3>
            <p className="muted">A plain-English reason behind every pick - no mystery, no black box.</p>
          </div>
        </div>
      </div>

      <div className="landing-section">
        <h2>What you get</h2>
        <div className="landing-feature-grid">
          <div className="landing-feature-card">
            <h3>A taste profile you can read</h3>
            <p className="muted">
              Not a black box - see exactly what FilmTonight thinks you like, and correct it anytime.
            </p>
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
            <p className="muted">Tell us your mood and get a pick on the spot.</p>
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
