// Generates the og:image (and, per Next's file-convention fallback rules,
// the twitter:image too - see app/twitter-image.js for why there's a
// second, near-identical file rather than relying on that fallback alone)
// for the root route ("/" - the landing page). Built with next/og's
// ImageResponse rather than a static asset file, so the headline is real
// text rendered at request time, not something to keep in sync with a
// hand-made image by hand. Colors match the "Classical" design system in
// app/globals.css (--color-bg, --color-accent-700, --color-text).
import { ImageResponse } from "next/og";

export const alt = "CineMatch - Stop wasting 5 days a year deciding what to watch";
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
          background: "#f3f2f2",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", fontSize: 32, fontWeight: 700, color: "#7d5411", marginBottom: 28 }}>
          CineMatch
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 62,
            fontWeight: 700,
            color: "#201f1d",
            lineHeight: 1.15,
            maxWidth: 980,
          }}
        >
          Stop wasting 5 days a year deciding what to watch.
        </div>
        <div style={{ display: "flex", fontSize: 30, color: "#605d5d", marginTop: 32, maxWidth: 880 }}>
          Rate what you&apos;ve watched, get an AI-built taste profile, and get picks that actually fit you.
        </div>
      </div>
    ),
    { ...size }
  );
}
