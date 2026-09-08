"use client";

import { useEffect, useState } from "react";

import { isBrowser } from "@/shared/utils/typeChecks.js";

/**
 * Switch between the previous dashboard and the Durin DS rewrite.
 *
 * The choice lives in a cookie because the server decides which route tree
 * renders before any client code runs, and it reloads on change for the same
 * reason. This component is deliberately dependency-free and duplicated into
 * the legacy tree, so a reader who switches to the old interface still has a
 * way back.
 *
 * Retiring the preview means deleting this file, its two callers, the
 * `/legacy-ui` tree, and the rewrite in `dashboardGuard.js`.
 */
const COOKIE = "durindoor-ui-version";

function readCookie() {
  if (!isBrowser()) return "legacy";
  const match = document.cookie.split("; ").find((row) => row.startsWith(`${COOKIE}=`));
  return match?.split("=")[1] === "new" ? "new" : "legacy";
}

export default function UiVersionSwitch() {
  const [version, setVersion] = useState("legacy");
  const [pending, setPending] = useState(false);

  useEffect(() => setVersion(readCookie()), []);

  const choose = (next) => {
    if (next === version || pending) return;
    setPending(true);
    // One year, path-wide: the preference has to survive navigation and
    // restarts or it cannot be lived with long enough to judge.
    document.cookie = `${COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    window.location.reload();
  };

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-[13px] font-medium text-text-main">Dashboard version</p>
        <p className="mt-0.5 text-xs text-text-muted">
          Try the redesigned dashboard before it becomes the default. Switching reloads the page and only affects this browser.
        </p>
      </div>
      <div role="group" aria-label="Dashboard version" className="flex shrink-0 gap-1 rounded-lg border border-border bg-surface-2 p-1">
        {[
          { value: "legacy", label: "Old UI" },
          { value: "new", label: "New UI" },
        ].map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => choose(option.value)}
            aria-pressed={version === option.value}
            disabled={pending}
            className={`min-h-11 rounded-lg px-3 text-[13px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-gold disabled:opacity-60 ${
              version === option.value
                ? "bg-gold text-black"
                : "text-text-main hover:bg-surface-3"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
