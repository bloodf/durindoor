"use client";

import { useEffect } from "react";
import EmptyState from "@/shared/ui/components/EmptyState.jsx";
import Button from "@/shared/ui/components/Button.jsx";
import { useUiV5 } from "@/shared/ui/v5/production/uiVersion.js";
import MotionIcon from "@/shared/ui/v5/motion/MotionIcon.jsx";

export default function MitmError({ error, reset }) {
  const v5 = useUiV5();
  useEffect(() => {
    console.error("MITM page error:", error);
  }, [error]);

  if (!v5) {
    return (
      <div className="flex items-center justify-center py-20">
        <EmptyState
          icon="warning"
          title="Something went wrong"
          message="The MITM page failed to load. This may happen during hydration in production builds."
          action={{ label: "Try again", icon: "refresh", onClick: reset }}
        />
      </div>
    );
  }

  return (
    <div
      role="alert"
      className="v5-dashboard-page flex min-w-0 items-center justify-center py-20 text-dd-text"
    >
      <div className="flex flex-col items-center gap-3 px-4 py-10 text-center text-[13px]">
        <span className="flex size-12 items-center justify-center rounded-dd-lg bg-dd-warning/10 text-dd-warning">
          <MotionIcon name="warning" size={24} />
        </span>
        <div className="flex max-w-sm flex-col gap-1">
          <p className="text-sm font-semibold text-dd-text">Something went wrong</p>
          <p className="text-[13px] text-dd-muted">
            The MITM page failed to load. This may happen during hydration in production builds.
          </p>
        </div>
        <Button variant="primary" icon="refresh" onClick={reset}>
          Try again
        </Button>
      </div>
    </div>
  );
}
