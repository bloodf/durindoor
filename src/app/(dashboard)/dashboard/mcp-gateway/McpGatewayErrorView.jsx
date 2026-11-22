"use client";

import EmptyState from "@/shared/ui/components/EmptyState.jsx";
import Button from "@/shared/ui/components/Button.jsx";
import { useUiV5 } from "@/shared/ui/v5/production/uiVersion.js";
import MotionIcon from "@/shared/ui/v5/motion/MotionIcon.jsx";

export default function McpGatewayErrorView({ reset }) {
  const v5 = useUiV5();

  if (!v5) {
    return (
      <main className="mx-auto flex w-full max-w-3xl flex-col items-center justify-center py-16 text-[13px]">
        <EmptyState
          icon="error"
          title="MCP Gateway failed to load"
          message="This usually happens during initial hydration or when the dashboard API is unreachable. Try again to reload the page."
          action={{ label: "Try again", icon: "refresh", onClick: () => reset() }}
        />
        <p className="mt-6 text-xs text-dd-subtle">If the error persists, the dashboard server logs may include more detail.</p>
      </main>
    );
  }

  return (
    <main
      role="alert"
      className="mx-auto flex w-full min-w-0 max-w-3xl flex-col items-center justify-center gap-4 py-16 text-[13px] text-dd-text"
    >
      <span className="flex size-12 items-center justify-center rounded-dd-lg bg-dd-danger/10 text-dd-danger">
        <MotionIcon name="error" size={24} />
      </span>
      <div className="flex max-w-sm flex-col gap-1 text-center">
        <p className="text-sm font-semibold text-dd-text">MCP Gateway failed to load</p>
        <p className="text-[13px] text-dd-muted">
          This usually happens during initial hydration or when the dashboard API is unreachable. Try again to reload the page.
        </p>
      </div>
      <Button variant="primary" icon="refresh" onClick={() => reset()}>
        Try again
      </Button>
      <p className="mt-2 text-xs text-dd-subtle">If the error persists, the dashboard server logs may include more detail.</p>
    </main>
  );
}
