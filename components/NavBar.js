"use client";

import { useState } from "react";
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
