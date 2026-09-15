import "./globals.css";

export const metadata = {
  title: "CineMatch",
  description: "Rate movies and TV shows, get an AI-built taste profile, and get recommendations you'll actually like.",
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
