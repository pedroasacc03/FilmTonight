// Terms of Service - publicly readable (no auth required), same reasoning
// as app/privacy/page.js (its counterpart). Same caveat applies: real
// identifying details, but still no formal legal review.

import { getCurrentUser } from "@/lib/session";
import NavBar from "@/components/NavBar";
import Link from "next/link";

export const metadata = { title: "Terms of Service - FilmTonight" };

export default async function TermsPage() {
  const user = await getCurrentUser();

  return (
    <>
      {user ? (
        <NavBar activePath="/terms" />
      ) : (
        <div className="navbar">
          <span className="brand">FilmTonight</span>
          <nav>
            <Link href="/login">Log in</Link>
          </nav>
        </div>
      )}
      <div className="page" style={{ maxWidth: 760 }}>
        <h1>Terms of Service</h1>
        <p className="muted">Last updated: September 5, 2026</p>

        <div className="card">
          <h2>1. Acceptance</h2>
          <p>
            FilmTonight is operated by <strong>Pedro Sena</strong>, based in São Paulo, Brazil. By creating a
            FilmTonight account, you&apos;re agreeing to these Terms of Service with Pedro, and to our{" "}
            <Link href="/privacy">Privacy Policy</Link>. If you don&apos;t agree, please don&apos;t use FilmTonight.
          </p>
        </div>

        <div className="card">
          <h2>2. What FilmTonight is</h2>
          <p>
            FilmTonight is an AI-assisted movie and TV recommendation platform, currently offered as an early-stage
            (MVP) product. You rate what you&apos;ve watched, an AI builds a taste profile from that, and it
            recommends new titles based on it. Title details, streaming availability, and Rotten Tomatoes/IMDb
            scores are looked up via TMDB (The Movie Database) and OMDb, third-party movie/TV databases - not
            looked up by the AI itself. Even so, this data is a best effort: it may be incomplete, outdated, or
            occasionally mismatched to the wrong title, and shouldn&apos;t be relied on as a guarantee that a title
            is actually available where you are. Always verify with the streaming service directly before assuming.
          </p>
        </div>

        <div className="card">
          <h2>3. Eligibility</h2>
          <p>
            You must be old enough, under the law that applies to you, to agree to these terms on your own behalf.
            If you&apos;re not, a parent or legal guardian needs to agree on your behalf and manage the account.
          </p>
        </div>

        <div className="card">
          <h2>4. Your account</h2>
          <ul>
            <li>Give us accurate information and keep your password secure - you&apos;re responsible for what happens under your account.</li>
            <li>One account per person. Don&apos;t share your login.</li>
            <li>Tell us if you think your account has been compromised.</li>
          </ul>
        </div>

        <div className="card">
          <h2>5. Acceptable use</h2>
          <p>Don&apos;t use FilmTonight to:</p>
          <ul>
            <li>Scrape, bulk-extract, or resell data from the app;</li>
            <li>Try to bypass rate limits or abuse the AI features to run up costs on our end;</li>
            <li>Submit unlawful, abusive, or infringing content in ratings, notes, or chat messages;</li>
            <li>Attempt to access another user&apos;s account or data.</li>
          </ul>
          <p>We may suspend or terminate accounts that violate this section.</p>
        </div>

        <div className="card">
          <h2>6. No warranty</h2>
          <p>
            FilmTonight is provided &quot;as is,&quot; without warranties of any kind, express or implied. As an
            early-stage product, features may change, break, or be removed. AI-generated recommendations, summaries,
            and streaming/availability info (Section 2) are not guaranteed to be accurate, complete, or current.
          </p>
        </div>

        <div className="card">
          <h2>7. Limitation of liability</h2>
          <p>
            To the maximum extent permitted by law, we aren&apos;t liable for any indirect, incidental, or
            consequential damages arising from your use of FilmTonight, including decisions made based on an AI
            recommendation or streaming-availability info that turned out to be wrong.
          </p>
        </div>

        <div className="card">
          <h2>8. Termination</h2>
          <p>
            You can stop using FilmTonight at any time and request account deletion per our{" "}
            <Link href="/privacy">Privacy Policy</Link>. We may suspend or terminate your account for violating
            Section 5, or discontinue the service entirely, with notice where reasonably possible.
          </p>
        </div>

        <div className="card">
          <h2>9. Changes</h2>
          <p>
            We may update these terms or the service itself as FilmTonight develops. We&apos;ll flag material
            changes to these terms before they take effect.
          </p>
        </div>

        <div className="card">
          <h2>10. Governing law</h2>
          <p>
            These terms are governed by the laws of Brazil. Any dispute will be submitted to the courts of{" "}
            <strong>São Paulo, SP, Brazil</strong>.
          </p>
        </div>

        <div className="card">
          <h2>11. Contact</h2>
          <p>
            Questions about these terms: <strong>pedrocatalao767@gmail.com</strong> (Pedro Sena, São Paulo, Brazil).
          </p>
        </div>
      </div>
    </>
  );
}
