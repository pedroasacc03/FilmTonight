import "./globals.css";

// Absolute base URL social crawlers (LinkedIn, Instagram bio link previews,
// Twitter/X, etc.) resolve the relative og:image URL against - without this,
// Next.js falls back to a guess (logs a build warning) that's wrong outside
// local dev. SITE_URL is configurable via env like the rest of the app's
// external-facing config, defaulting to local dev's own address.
const SITE_URL = process.env.SITE_URL || "http://localhost:3000";
const DESCRIPTION = "Rate what you've watched, get an AI-built taste profile, and get picks that actually fit you.";

export const metadata = {
  metadataBase: new URL(SITE_URL),
  title: "CineMatch",
  description: DESCRIPTION,
  // og:image itself comes from app/opengraph-image.js (next/og-generated,
  // not a static file) - Next.js wires it into both the openGraph.images
  // and twitter.images tags automatically from that one file, including
  // og:image:width/height/type, so it doesn't need to be repeated here.
  openGraph: {
    title: "CineMatch - Stop wasting 5 days a year deciding what to watch",
    description: DESCRIPTION,
    url: "/",
    siteName: "CineMatch",
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "CineMatch - Stop wasting 5 days a year deciding what to watch",
    description: DESCRIPTION,
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        {children}
        {/* TMDB's API Terms of Use require attribution wherever their data
            is shown - true of nearly every page here (title names, genres,
            posters, streaming availability all come from them - see
            lib/titles.js). Global via the root layout so it's automatically
            present on every current and future page, not something to
            remember to add per-page. */}
        <footer className="app-footer">
          This product uses the TMDB API but is not endorsed or certified by TMDB. Movie/TV data from{" "}
          <a href="https://www.themoviedb.org/" target="_blank" rel="noopener noreferrer">
            TMDB
          </a>{" "}
          and{" "}
          <a href="https://www.omdbapi.com/" target="_blank" rel="noopener noreferrer">
            OMDb
          </a>
          .
        </footer>
      </body>
    </html>
  );
}
