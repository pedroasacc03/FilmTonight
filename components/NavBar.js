"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

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

  // Energy status (see lib/energy.js) is fetched client-side here rather
  // than threaded as a prop through every page that renders <NavBar> - this
  // is the one place in the app already positioned to show it on every
  // page. `tier` starts null so the Pro/Upgrade link doesn't flash the
  // wrong label before the fetch resolves; `energy` stays null (renders
  // nothing) for Pro/beta_pro and when ENERGY_SYSTEM_ENABLED=false, since
  // the indicator must never show for a non-free tier, anywhere.
  const [tier, setTier] = useState(null);
  const [energy, setEnergy] = useState(null);

  async function refreshEnergyStatus() {
    try {
      const res = await fetch("/api/energy/status");
      if (!res.ok) return;
      const data = await res.json();
      setTier(data.tier ?? null);
      setEnergy(data.status ?? null);
    } catch {
      // Silent - the nav still works fine without this, it just won't show
      // the indicator this load.
    }
  }

  useEffect(() => {
    refreshEnergyStatus();
    // Fired by EnergyLimitWatcher right after a successful beta-Pro grant,
    // so the nav reflects the new tier immediately instead of waiting for
    // the next full navigation (NavBar re-fetches on mount anyway, but a
    // grant doesn't navigate anywhere).
    window.addEventListener("energy:refresh", refreshEnergyStatus);
    return () => window.removeEventListener("energy:refresh", refreshEnergyStatus);
  }, []);

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
