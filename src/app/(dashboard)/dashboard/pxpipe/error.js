"use client";

import { useEffect } from "react";
import PropTypes from "prop-types";
import EmptyState from "@/shared/ui/components/EmptyState.jsx";
import Button from "@/shared/ui/components/Button.jsx";
import { useUiV5 } from "@/shared/ui/v5/production/uiVersion.js";
import MotionIcon from "@/shared/ui/v5/motion/MotionIcon.jsx";

export default function PxpipeError({ error, reset }) {
  const v5 = useUiV5();
  useEffect(() => {
    console.error("PXPIPE page error:", error);
  }, [error]);

  if (!v5) {
    return (
      <section className="m-4 overflow-hidden rounded-dd-lg border border-dd-border bg-dd-surface sm:m-6">
        <EmptyState
          icon="warning"
          title="PXPIPE dashboard could not load"
          message="Refresh this view to retry loading compression activity."
          action={{ label: "Try again", icon: "refresh", onClick: reset }}
        />
      </section>
    );
  }

  return (
    <section
      role="alert"
      className="m-4 min-w-0 overflow-hidden rounded-dd-lg border border-dd-border bg-dd-surface text-[13px] text-dd-text sm:m-6"
    >
      <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
        <span className="flex size-12 items-center justify-center rounded-dd-lg bg-dd-warning/10 text-dd-warning">
          <MotionIcon name="warning" size={24} />
        </span>
        <div className="flex max-w-sm flex-col gap-1">
          <p className="text-sm font-semibold text-dd-text">PXPIPE dashboard could not load</p>
          <p className="text-[13px] text-dd-muted">Refresh this view to retry loading compression activity.</p>
        </div>
        <Button variant="primary" icon="refresh" onClick={reset}>
          Try again
        </Button>
      </div>
    </section>
  );
}

PxpipeError.propTypes = {
  error: PropTypes.instanceOf(Error).isRequired,
  reset: PropTypes.func.isRequired,
};
