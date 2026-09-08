"use client";

import { useEffect } from "react";
import PropTypes from "prop-types";
import EmptyState from "@/shared/ui/components/EmptyState.jsx";

export default function PxpipeError({ error, reset }) {
  useEffect(() => {
    console.error("PXPIPE page error:", error);
  }, [error]);

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

PxpipeError.propTypes = {
  error: PropTypes.instanceOf(Error).isRequired,
  reset: PropTypes.func.isRequired,
};
