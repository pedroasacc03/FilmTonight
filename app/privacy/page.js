// Privacy Policy - publicly readable (no auth required), since prospective
// users need to read it BEFORE registering, not just after. Shows the normal
// NavBar for signed-in visitors and a simple header otherwise, so it's
// reachable from both contexts. See app/terms/page.js for its counterpart.
//
// IMPORTANT: this is a plain-language draft grounded in what the app
// actually does (see prisma/schema.prisma and lib/*.js), not a substitute
// for review by a lawyer qualified in Brazilian law (LGPD). All identifying
// details below are filled in for real, but this still hasn't had a formal
// legal review - get one before relying on it at any real scale.

import { getCurrentUser } from "@/lib/session";
import NavBar from "@/components/NavBar";
import Link from "next/link";

export const metadata = { title: "Privacy Policy - FilmTonight" };

export default async function PrivacyPage() {
  const user = await getCurrentUser();

  return (
    <>
      {user ? (
        <NavBar activePath="/privacy" />
      ) : (
        <div className="navbar">
          <span className="brand">FilmTonight</span>
          <nav>
            <Link href="/login">Log in</Link>
          </nav>
        </div>
      )}
      <div className="page" style={{ maxWidth: 760 }}>
        <h1>Privacy Policy</h1>
        <p className="muted">Last updated: September 5, 2026 · Effective for accounts created on or after August 26, 2026</p>

        <div className="card">
          <h2>1. Who this is</h2>
          <p>
            FilmTonight is operated by <strong>Pedro Sena</strong> (&quot;we&quot;, &quot;us&quot;), an individual
            based in São Paulo, Brazil. This policy explains what personal data we collect through the FilmTonight
            app, why, and what rights you have over it under Brazil&apos;s Lei Geral de Proteção de Dados (LGPD).
            You can reach us at <strong>pedrocatalao767@gmail.com</strong> for anything in this policy, including
            exercising your rights below - Pedro is the point of contact for all data-protection matters.
          </p>
        </div>

        <div className="card">
          <h2>2. What we collect</h2>
          <p>Only what the app needs to do its job. Specifically:</p>
          <ul>
            <li><strong>Account info:</strong> your email, password (never stored in plain text - see Section 6), and optionally your name.</li>
            <li>
              <strong>What you rate:</strong> the titles you mark watched/want-to-watch/not-interested, your star
              ratings, and any free-text &quot;why&quot; you write - this is the main signal the AI uses to build
              your taste profile.
            </li>
            <li>
              <strong>Your AI-built taste profile:</strong> genres, themes, storytelling preferences, favorite
              creators, and similar notes the AI derives from the above. Fully visible and editable on your
              &quot;My Preferences&quot; page.
            </li>
            <li>
              <strong>Region and streaming services (optional):</strong> if you choose to share your location or
              the streaming services you have, we use it only to make streaming-availability info more accurate -
              your region is sent to TMDB (Section 4) for this specific purpose. Never required.
            </li>
            <li>
              <strong>Title searches:</strong> when you search for a movie/TV show (on the Ratings/Wishlist pages,
              or indirectly through a rating or AI recommendation), the title name is sent to TMDB to look up its
              details - see Section 4.
            </li>
            <li><strong>Chat messages:</strong> what you send the FilmTonight chatbot, and its replies.</li>
            <li>
              <strong>Basic account-milestone events:</strong> a small, first-party log of a handful of moments -
              that you signed up, made your first rating, and reached 10 watched ratings. Kept only to understand
              product usage in aggregate; see Section 5 for what this is (and isn&apos;t).
            </li>
          </ul>
        </div>

        <div className="card">
          <h2>3. Why we collect it, and your consent</h2>
          <p>
            We process your data on the basis of your <strong>consent</strong> (LGPD Art. 7, I), which you give
            explicitly by checking the consent box when you create your account. Consent is opt-in: nothing is
            collected before you affirmatively agree, and your account cannot be created without it. You can
            withdraw consent at any time (Section 7) - if you do, we stop processing your data and, on request,
            delete it.
          </p>
          <p>
            Account credentials (email/password) are additionally processed under LGPD Art. 7, V, since they&apos;re
            necessary to provide the service you&apos;ve asked for (letting you log in at all).
          </p>
        </div>

        <div className="card">
          <h2>4. How your data is used</h2>
          <p>
            Your ratings and taste profile are used to generate personalized recommendations and to power the
            chatbot (which can also read and update your ratings, wishlist, and profile on request - the same
            data described in Section 2, just through a conversational interface instead of the regular pages).
            To do this, relevant parts of your data (ratings, your &quot;why&quot; notes, your taste profile, and
            chat messages) are sent to <strong>Anthropic</strong>, the AI provider behind FilmTonight, for processing.
            Anthropic acts as our data processor for this purpose.
          </p>
          <p>
            Separately, movie/TV metadata - title details, genres, cast, streaming availability, and Rotten
            Tomatoes/IMDb scores - comes from two third-party movie databases: <strong>TMDB</strong> (The Movie
            Database) and <strong>OMDb</strong>. These receive only the title being looked up (and, for
            streaming-availability accuracy, your region if you&apos;ve set one) - never your ratings, &quot;why&quot;
            notes, taste profile, chat messages, or account/identity info. TMDB and OMDb act as our data processors
            for this specific, narrower purpose.
          </p>
          <p>
            Because Anthropic, TMDB, and OMDb all process data outside Brazil, this involves an <strong>international
            transfer of personal data</strong> (LGPD Art. 33). We rely on your consent (Section 3) as the legal basis
            for these transfers, together with each provider&apos;s own contractual data-protection commitments as
            our sub-processors.
          </p>
        </div>

        <div className="card">
          <h2>5. Who we share it with</h2>
          <p>
            <strong>Anthropic, TMDB, and OMDb</strong> (Section 4) are the only third parties your data is sent to -
            each for the specific, limited purpose described there. We do not sell your data, and we do not share
            it with advertisers, data brokers, or third-party analytics companies - because we don&apos;t use any.
            There is no tracking pixel, no ad network, and no third-party analytics SDK anywhere in FilmTonight.
          </p>
          <p>
            The only usage data we keep is the small, first-party account-milestone log mentioned in Section 2
            (signup, first rating, reaching 10 watched ratings) - it lives in our own database, is never sent to
            any third party or analytics vendor, and is used only in aggregate to understand how the product is
            used, not to profile you individually.
          </p>
        </div>

        <div className="card">
          <h2>6. How we protect your data</h2>
          <ul>
            <li>Passwords are never stored in plain text - they&apos;re hashed with scrypt, a slow, purpose-built algorithm for this.</li>
            <li>Your login session is a signed, HTTP-only cookie that can&apos;t be read or forged by client-side scripts.</li>
            <li>All traffic to FilmTonight should be served over HTTPS in production.</li>
          </ul>
        </div>

        <div className="card">
          <h2>7. Your rights under LGPD</h2>
          <p>You can ask us, at any time, to:</p>
          <ul>
            <li>Confirm whether we process your data, and give you access to it;</li>
            <li>Correct incomplete, inaccurate, or outdated data;</li>
            <li>Anonymize, block, or delete data that&apos;s unnecessary or excessive, or that you no longer want us to keep;</li>
            <li>Give you a portable copy of your data;</li>
            <li>Tell you which entities (public or private) we&apos;ve shared your data with;</li>
            <li>Tell you the consequences of not consenting, where relevant;</li>
            <li>Let you withdraw your consent altogether;</li>
            <li>Review a decision made solely by automated processing that affects you (Section 8).</li>
          </ul>
          <p>
            Right now, you can edit or delete individual ratings and your taste profile directly in the app (the
            Watched, Wishlist, and My Preferences pages). For account-level requests - a full export, or deleting
            your account entirely - email us at <strong>pedrocatalao767@gmail.com</strong> and we&apos;ll act on it
            within a reasonable time, consistent with LGPD Art. 19.
          </p>
        </div>

        <div className="card">
          <h2>8. Automated decisions</h2>
          <p>
            Your recommendations and taste profile are generated by an AI model, without a human reviewing each
            one. Under LGPD Art. 20, you can ask us for a plain-language explanation of the criteria behind a
            given recommendation or profile note, and request a review. Since the profile itself is fully visible
            and directly editable on the My Preferences page, you can also just correct it yourself at any time.
          </p>
        </div>

        <div className="card">
          <h2>9. Cookies</h2>
          <p>
            FilmTonight sets exactly one cookie: a signed session token that keeps you logged in. It&apos;s strictly
            necessary for the app to function and isn&apos;t used for tracking, profiling, or advertising. We
            don&apos;t use any third-party cookies.
          </p>
        </div>

        <div className="card">
          <h2>10. Children</h2>
          <p>
            FilmTonight isn&apos;t directed at children and requires you to be old enough, under the law of your
            country, to give your own consent to this policy. We don&apos;t knowingly collect data from children
            without the specific, informed consent of a parent or legal guardian, as required by LGPD Art. 14.
          </p>
        </div>

        <div className="card">
          <h2>11. Changes to this policy</h2>
          <p>
            If we make a material change to how we handle your data, we&apos;ll notify you (e.g. in-app or by
            email) before it takes effect, and, where the change affects the basis we rely on, ask for your
            consent again.
          </p>
        </div>

        <div className="card">
          <h2>12. Contact</h2>
          <p>
            Questions, requests, or complaints about this policy or your data:{" "}
            <strong>pedrocatalao767@gmail.com</strong> (Pedro Sena, São Paulo, Brazil). You can also lodge a
            complaint with Brazil&apos;s data protection authority, the ANPD (Autoridade Nacional de Proteção de
            Dados).
          </p>
        </div>

        <p className="muted" style={{ marginTop: 24 }}>
          See also our <Link href="/terms">Terms of Service</Link>.
        </p>
      </div>
    </>
  );
}
