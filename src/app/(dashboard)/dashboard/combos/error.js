"use client";

import { useEffect } from "react";
import Link from "next/link";
import Button from "@/shared/ui/components/Button.jsx";

export default function CombosError({ error, reset }) {
  useEffect(() => {
    console.error("Combos page error:", error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
      <span aria-hidden="true" className="material-symbols-outlined text-4xl text-dd-warning">
        warning
      </span>
      <p className="text-lg font-semibold text-dd-text">Something went wrong</p>
      <p className="max-w-md text-sm text-dd-muted">
        The combos page failed to load. This may happen during hydration in
        production builds.
      </p>
      <div className="flex gap-3">
        <Button variant="primary" onClick={() => reset()}>
          Try again
        </Button>
        <Link
          href="/dashboard"
          className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-dd border border-dd-border bg-dd-surface-2 px-3.5 text-[13px] font-medium text-dd-text outline-none transition-colors hover:bg-dd-surface-3 focus-visible:shadow-dd-focus"
        >
          Back to Dashboard
        </Link>
      </div>
    </div>
  );
}