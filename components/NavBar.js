"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEnergyStatus } from "@/components/EnergyStatusProvider";

const LINKS = [
  { href: "/home", label: "Home" },
  { href: "/ratings", label: "Ratings" },
  { href: "/watched", label: "Watched" },
  { href: "/wishlist", label: "Wishlist" },
  { href: "/recommendations", label: "Recommendations" },
  { href: "/preferences", label: "My Preferences" },
  { href: "/chat", label: "Chat" },
];

export default function NavBar({ activePath }) {
  const router = useRouter();
  // Below 900px (see .navbar-menu-toggle in globals.css) the 7 links + Privacy
  // + Log out don't fit in one row, so they collapse into this tap-to-open
  // dropdown instead. Closing on link/logout click matters for UX even though
  // navigating to a new page remounts NavBar with this reset anyway - it
  // makes the menu visibly close right away instead of lagging behind the
  // page transition.
  const [menuOpen, setMenuOpen] = useState(false);

  // Energy/tier status lives in EnergyStatusProvider (mounted once in the
  // root layout - see that file for why NavBar can't own this itself
  // anymore: it used to fetch locally, but NavBar is a fresh component
  // instance on every navigation, so that meant refetching from a blank
  // state on every single page change - a real, measured ~80-100ms flicker
  // of the energy indicator and Upgrade/Pro link vanishing and
  // reappearing. Reading from the provider instead means this always
  // starts from the last-known value, not null.
  const { tier, energy } = useEnergyStatus();

  async function handleLogout() {
    setMenuOpen(false);
    await fetch("/api/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="navbar">
      <span className="brand">FilmTonight</span>
      <button
        type="button"
        className="navbar-menu-toggle"
        onClick={() => setMenuOpen((prev) => !prev)}
        aria-expanded={menuOpen}
      >
        {menuOpen ? "Close" : "Menu"}
      </button>
      <nav className={menuOpen ? "open" : ""}>
        {LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={activePath === link.href ? "active" : ""}
            onClick={() => setMenuOpen(false)}
          >
            {link.label}
          </Link>
        ))}
        {tier && (
          <Link href="/pro" className={activePath === "/pro" ? "active" : ""} onClick={() => setMenuOpen(false)}>
            {/* "Beta Pro" (not just "Pro") for that tier specifically - real
                paid Pro doesn't exist yet, and staying honest about which
                one someone has is the whole point of naming them
                differently in the first place (see app/pro/page.js). */}
            {tier === "free" ? "Upgrade" : tier === "beta_pro" ? "Beta Pro" : "Pro"}
          </Link>
        )}
        {tier === "free" && energy && (
          <Link
            href="/pro"
            className="energy-indicator"
            onClick={() => setMenuOpen(false)}
            title={
              energy.energy > energy.ceiling
                ? `${energy.energy} energy (includes a Recharge top-up) - resets to ${energy.ceiling}/day at midnight UTC`
                : `${energy.energy}/${energy.ceiling} energy today - resets at midnight UTC`
            }
          >
            {/* A Recharge purchase can push energy above the daily ceiling
                (it stacks and never expires - see lib/energy.js
                purchaseRecharge) - "12/4" would read as a bug, so once
                energy exceeds the ceiling this drops the "/ceiling" part
                and just shows the raw total instead. */}
            <span aria-hidden="true">⚡</span>{" "}
            {energy.energy > energy.ceiling ? energy.energy : `${energy.energy}/${energy.ceiling}`}
          </Link>
        )}
        <Link href="/privacy" style={{ fontSize: 12, opacity: 0.7 }} onClick={() => setMenuOpen(false)}>
          Privacy
        </Link>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleLogout();
          }}
        >
          <button type="submit">Log out</button>
        </form>
      </nav>
    </div>
  );
}
