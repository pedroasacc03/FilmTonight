// Generates the og:image (and, per Next's file-convention fallback rules,
// the twitter:image too - verified live, a single file produces correct
// og:image:width/height/type AND twitter:image:width/height/type tags, no
// separate twitter-image.js needed) for the root route ("/" - the landing
// page). Built with next/og's ImageResponse rather than a static asset
// file, so the headline is real text rendered at request time, not
// something to keep in sync with a hand-made image by hand. Colors are the
// FilmTonight brand palette (Brand Foundation Brief - navy/amber), matching
// the .brand-dark theme in app/globals.css.
import { ImageResponse } from "next/og";

export const alt = "FilmTonight - Stop wasting 5 days a year deciding what to watch";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px 96px",
          background: "#1b1f3b",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", fontSize: 32, fontWeight: 700, color: "#f0a93a", marginBottom: 28 }}>
          FilmTonight
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 62,
            fontWeight: 700,
            color: "#f2efe7",
            lineHeight: 1.15,
            maxWidth: 980,
          }}
        >
          Stop wasting 5 days a year deciding what to watch.
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 30,
            color: "#b6b3ae",
            marginTop: 32,
            maxWidth: 880,
          }}
        >
          Rate what you&apos;ve watched, get an AI-built taste profile, and get picks that actually fit you.
        </div>
      </div>
    ),
    { ...size }
  );
}
