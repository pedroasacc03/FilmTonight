// The marketing landing page's markup and behavior, rendered at "/" (the
// site's front door - what a brand-new visitor sees before login/register).
// Uses FilmTonight's navy/amber palette (app/globals.css), per the Brand
// Foundation Brief - the whole app's default theme, not just this page.

import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { TAGLINE } from "@/lib/brand";

export default async function LandingPage() {
  // A signed-in visitor doesn't need the pitch - send them straight in.
  const user = await getCurrentUser();
  if (user) redirect("/home");

  return (
    <>
      <div className="landing-nav">
        <span className="brand">FilmTonight</span>
        <Link href="/login">Log in</Link>
      </div>

      <div className="landing-hero">
        <p className="landing-kicker">{TAGLINE}</p>
        <h1>Movie and TV picks that actually fit your taste.</h1>
        <p>
          You waste about 5 days a year just deciding what to watch. Twenty minutes of scrolling tonight is twenty
          minutes you won&apos;t get back - FilmTonight narrows it down to a handful of picks that actually fit you,
          so you can just press play.
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
        <h2>See it in action</h2>
        <p className="landing-screenshots-intro muted">Real screens from the app - not mockups.</p>
        <figure className="landing-screenshot">
          <img
            src="/screenshots/recommendation-why.png"
            alt="A FilmTonight recommendation card for the show MINDHUNTER, with a 'Why you'll like it' note explaining that Fincher-directed episodes and a psychological, control-driven approach to criminal minds make it a near-perfect match for the user's taste."
            width={980}
            height={219}
            loading="lazy"
          />
          <figcaption>A recommendation, and the actual reason behind it - never just a star rating.</figcaption>
        </figure>
        <div className="landing-screenshot-grid">
          <figure className="landing-screenshot">
            <img
              src="/screenshots/taste-profile-summary.png"
              alt="The My Preferences page showing an AI-written taste-profile summary and a list of editable 'drawn to' chips like 'obsessive drive toward mastery' and 'sharp, fast dialogue.'"
              width={1000}
              height={519}
              loading="lazy"
            />
            <figcaption>Your taste profile, in plain English - and every chip is editable.</figcaption>
          </figure>
          <figure className="landing-screenshot">
            <img
              src="/screenshots/taste-profile-genres.png"
              alt="The My Preferences page showing star-rated genre confidence for Drama, Thriller, Mystery, and others, plus a Favorite Directors/Creators/Actors section listing David Fincher."
              width={1000}
              height={483}
              loading="lazy"
            />
            <figcaption>Genre confidence and favorite creators, picked up automatically as you rate.</figcaption>
          </figure>
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
    </>
  );
}
