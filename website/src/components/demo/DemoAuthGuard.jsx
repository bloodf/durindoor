"use client";

import { useEffect, useState } from "react";

// Every /dashboard/* page under the demo is client-rendered against the
// mocked backend, so there is no server middleware to gate the route.
// Check the mocked session on mount and bounce to /login when signed out.
export default function DemoAuthGuard({ children }) {
  const [authenticated, setAuthenticated] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/status", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (data?.authenticated !== true) {
          window.location.replace("/login");
          return;
        }
        setAuthenticated(true);
      })
      .catch(() => {
        if (!cancelled) window.location.replace("/login");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!authenticated) return null;
  return children;
}
