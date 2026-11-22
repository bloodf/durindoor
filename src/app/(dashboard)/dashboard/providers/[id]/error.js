"use client";

import { useEffect } from "react";
import Link from "next/link";

import Button from "@/shared/ui/components/Button.jsx";
import { useUiV5 } from "@/shared/ui/v5/production/uiVersion.js";
import MotionIcon from "@/shared/ui/v5/motion/MotionIcon.jsx";

export default function ProviderDetailError({ error, reset }) {
  const v5 = useUiV5();
  useEffect(() => {
    console.error("Provider detail page error:", error);
  }, [error]);

  // Preserve the legacy boundary while providing an announced V5 recovery panel.
  if (v5) return (
    <div role="alert" className="mx-auto flex w-full min-w-0 max-w-2xl flex-col items-center gap-4 rounded-dd-lg border border-dd-border bg-dd-surface p-6 text-center text-dd-text sm:p-10">
      <span className="flex size-12 items-center justify-center rounded-dd-lg bg-dd-warning/10 text-dd-warning">
        <MotionIcon name="warning" size={24} />
      </span>
      <h2 className="text-lg font-semibold">Something went wrong</h2>
      <p className="max-w-md text-[13px] text-dd-muted">This provider page failed to load. Try refreshing, or go back to the providers list.</p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button variant="primary" onClick={() => reset()} icon="refresh">Try again</Button>
        <Link href="/dashboard/providers" className="inline-flex min-h-11 items-center gap-1.5 rounded-dd border border-dd-border bg-dd-surface-2 px-3.5 text-[13px] font-medium text-dd-text outline-none transition-colors hover:bg-dd-surface-3 focus-visible:shadow-dd-focus">Back to Providers</Link>
      </div>
    </div>
  );

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
