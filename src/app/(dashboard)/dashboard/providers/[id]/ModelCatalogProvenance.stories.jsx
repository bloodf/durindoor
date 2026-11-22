import React from "react";
import { expect, within } from "storybook/test";

import ModelCatalogProvenance from "./ModelCatalogProvenance";

const freshStatus = {
  enabled: true,
  models: ["gpt-4o"],
  syncedAt: "2020-01-01T00:00:00.000Z",
  intervalHours: 24 * 365 * 30,
};

const meta = {
  title: "Production/providers/ModelCatalogProvenance",
  component: ModelCatalogProvenance,
  args: { providerId: "openai", status: freshStatus },
  parameters: {
    layout: "padded",
    storyFixture: {
      scenario: "default",
      pathname: "/dashboard/providers/openai",
      params: { id: "openai" },
    },
  },
};

export default meta;

/** Discovery snapshot is inside the configured interval and does not claim vendor proof. */
export const Fresh = {
  play: async ({ canvasElement }) => {
    const view = within(canvasElement);
    await expect(view.getByLabelText("Model list provenance")).toBeInTheDocument();
    await expect(view.getByText("Provider discovery with derived registry variants")).toBeInTheDocument();
    await expect(view.getByText("Within the configured sync interval. Availability is not verified.")).toBeInTheDocument();
    await expect(view.getByText(/UNKNOWN\. A list-models response does not verify/)).toBeInTheDocument();
  },
};

/** Disabled discovery falls back to the built-in registry and unknown freshness. */
export const Empty = {
  args: { status: { enabled: false, models: [], syncedAt: null, intervalHours: null } },
  play: async ({ canvasElement }) => {
    const view = within(canvasElement);
    await expect(view.getByText("Built-in registry")).toBeInTheDocument();
    await expect(view.getByText("UNKNOWN")).toBeInTheDocument();
  },
};

/** A failed discovery keeps the previous snapshot and says so. */
export const Error = {
  args: { status: { ...freshStatus, error: "discovery failed" } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText("STALE. The last discovery attempt failed; the previous snapshot is retained.")).toBeInTheDocument();
  },
};
