"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { usePathname } from "next/navigation";

// Fixes a real, confirmed bug: NavBar used to fetch its own energy/tier
// status locally. Every page.js independently renders <NavBar>, so it's a
// brand-new component instance on every navigation (most pages return
// <><NavBar/>...</>, but app/chat/page.js wraps it in an extra
// .chat-page-shell div - a different element type at that tree position,
// which is enough on its own to force React to unmount/remount everything
// under it, NavBar included). A fresh instance means tier/energy reset to
// null and have to re-fetch from scratch - measured at ~80-100ms of the
// energy indicator and Upgrade/Pro link visibly vanishing and reappearing
// on literally every page change.
//
// The fix: own this state up here instead, in a provider mounted once in
// the root layout (app/layout.js) - like EnergyLimitWatcher, a root layout
// does NOT remount on client-side navigation, so this fetches once and the
// value persists across every page change. NavBar (and anything else) just
// reads it via useEnergyStatus() instead of fetching itself.
const EnergyStatusContext = createContext({ tier: null, energy: null, refresh: () => {} });

export function useEnergyStatus() {
  return useContext(EnergyStatusContext);
}

export default function EnergyStatusProvider({ children }) {
  const [tier, setTier] = useState(null);
  const [energy, setEnergy] = useState(null);
  const pathname = usePathname();

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/energy/status");
      if (res.status === 401) {
        // Logged out (or logging in as someone else) - never show a
        // previous session's stale tier/energy.
        setTier(null);
        setEnergy(null);
        return;
      }
      if (!res.ok) return;
      const data = await res.json();
      setTier(data.tier ?? null);
      setEnergy(data.status ?? null);
    } catch {
      // Silent - keep whatever was last known rather than blanking the nav.
    }
  }, []);

  // Re-fetch in the background on every navigation (pathname change) -
  // this is what keeps the number accurate as the user spends energy
  // around the app, and correctly picks up a tier/energy change after
  // logout -> a different login, since the provider itself never
  // remounts to do that automatically. Deliberately NOT reset to null
  // first: the whole point is the last-known value stays visible (no
  // flicker) while this resolves in the background.
  useEffect(() => {
    refresh();
  }, [pathname, refresh]);

  // Fired by EnergyLimitWatcher right after a successful beta-Pro grant or
  // Recharge purchase, for an immediate update with no navigation involved.
  useEffect(() => {
    window.addEventListener("energy:refresh", refresh);
    return () => window.removeEventListener("energy:refresh", refresh);
  }, [refresh]);

  return <EnergyStatusContext.Provider value={{ tier, energy, refresh }}>{children}</EnergyStatusContext.Provider>;
}
