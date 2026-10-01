import { useEffect, useState } from "react";

import { PlayerApp } from "./PlayerApp";
import { GmDashboard } from "./GmDashboard";
import { Watch } from "./Watch";
import { LegalFooter, Privacy, Terms } from "./Legal";

function useHashRoute(): string {
  const [route, setRoute] = useState(() => window.location.hash.replace(/^#\/?/, ""));
  useEffect(() => {
    const onChange = () => setRoute(window.location.hash.replace(/^#\/?/, ""));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

export function App() {
  const route = useHashRoute();
  const page =
    route === "gm" ? (
      <GmDashboard />
    ) : route.startsWith("watch") ? (
      <Watch />
    ) : route === "terms" ? (
      <Terms />
    ) : route === "privacy" ? (
      <Privacy />
    ) : (
      <PlayerApp />
    );
  return (
    <>
      {page}
      <LegalFooter />
    </>
  );
}
