"use client";

import { useEffect } from "react";
import Link from "next/link";

import Button from "@/shared/ui/components/Button.jsx";

export default function ProviderDetailError({ error, reset }) {
  useEffect(() => {
    console.error("Provider detail page error:", error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
      <span
        aria-hidden="true"
        className="material-symbols-outlined text-[40px] leading-none text-dd-warning"
      >
        warning
      </span>
      <p className="text-lg font-semibold text-dd-text">Something went wrong</p>
      <p className="max-w-md text-[13px] text-dd-muted">
        This provider page failed to load. This may happen during hydration in
        production builds. Try refreshing, or go back to the providers list.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button variant="primary" onClick={() => reset()} icon="refresh">
          Try again
        </Button>
        <Link
          href="/dashboard/providers"
          className="inline-flex min-h-11 items-center gap-1.5 rounded-dd border border-dd-border bg-dd-surface-2 px-3.5 text-[13px] font-medium text-dd-text outline-none transition-colors hover:bg-dd-surface-3 focus-visible:shadow-dd-focus"
        >
          <span aria-hidden="true" className="material-symbols-outlined text-[18px] leading-none">
            arrow_back
          </span>
          Back to Providers
        </Link>
      </div>
    </div>
  );
}
