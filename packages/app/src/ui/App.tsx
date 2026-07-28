import { useEffect, useState } from "react";

import { PlayerApp } from "./PlayerApp";
import { GmDashboard } from "./GmDashboard";

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
  return route === "gm" ? <GmDashboard /> : <PlayerApp />;
}
