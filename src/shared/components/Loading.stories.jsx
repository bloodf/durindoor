import React from "react";
import { expect, within } from "storybook/test";

import Card from "./Card.js";
import Loading, { CardSkeleton, PageLoading, Skeleton, Spinner } from "./Loading.js";

const meta = {
  title: "Production/Shared Surfaces/Loading",
  component: Loading,
  parameters: { layout: "centered" },
  argTypes: {
    type: { control: "radio", options: ["spinner", "skeleton", "card", "page"] },
  },
};

export default meta;

export const Playground = {
  args: { type: "spinner" },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("status")).toBeInTheDocument();
  },
};

export const SpinnerSizes = {
  render: () => (
    <div className="flex items-end gap-4">
      {["sm", "md", "lg", "xl"].map((size) => (
        <div key={size} className="flex flex-col items-center gap-2">
          <Spinner size={size} label={`Loading (${size})`} />
          <span className="text-[11px] text-dd-muted">{size}</span>
        </div>
      ))}
    </div>
  ),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getAllByRole("status")).toHaveLength(4);
  },
};

export const PageLoadingBehavior = {
  // Mounts the real, unmodified PageLoading component. It fills the viewport
  // by design — that is the production behavior callers rely on.
  render: () => <PageLoading message="Loading dashboard..." />,
  parameters: { layout: "fullscreen" },
  play: async () => {
    const dialog = document.body.querySelector('[role="status"][aria-live="polite"]');
    await expect(dialog).toBeInTheDocument();
    await expect(dialog).toHaveTextContent("Loading dashboard...");
  },
};

export const SkeletonVariants = {
  render: () => (
    <div className="flex w-96 flex-col gap-3">
      <Skeleton className="h-4 w-1/3" data-testid="skeleton-1" />
      <Skeleton className="h-4 w-2/3" data-testid="skeleton-2" />
      <Skeleton className="h-24 w-full" data-testid="skeleton-3" />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("skeleton-1")).toHaveClass("animate-pulse");
  },
};

export const CardSkeletonInGrid = {
  render: () => (
    <div className="grid w-[480px] grid-cols-2 gap-3">
      <CardSkeleton />
      <CardSkeleton />
      <CardSkeleton />
      <CardSkeleton />
    </div>
  ),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getAllByRole("status")).toHaveLength(4);
  },
};

export const LoadingSwitchboard = {
  render: () => (
    <div className="flex flex-col gap-4">
      <Loading type="spinner" />
      <Loading type="skeleton" className="h-4 w-1/2" />
      <Loading type="card" />
    </div>
  ),
};

export const ComposedWithSkeleton = {
  render: () => (
    <Card className="w-80" title="Sync queue" subtitle="Streaming in" icon="cloud_sync">
      <Skeleton className="mb-2 h-3 w-1/2" />
      <Skeleton className="h-3 w-3/4" />
    </Card>
  ),
};
