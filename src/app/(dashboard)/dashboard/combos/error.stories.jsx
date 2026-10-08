import React, { useState } from "react";
import { expect, userEvent, waitFor, within, spyOn } from "storybook/test";
import CombosError from "./error.js";

const fixtureError = new Error("Combo catalog unavailable");

function RetryHarness() {
  const [retried, setRetried] = useState(false);
  return <>{retried ? <p>Retry requested</p> : <CombosError error={fixtureError} reset={() => setRetried(true)} />}</>;
}

export default {
  title: "Production/combos/CombosError",
  component: CombosError,
  parameters: { storyFixture: { scenario: "error", pathname: "/dashboard/combos" } },
};

export const Retry = {
  render: () => <RetryHarness />,
  beforeEach: () => {
    const original = console.error;
    const log = spyOn(console, "error").mockImplementation((...args) => {
      if (args.length !== 2 || args[0] !== "Combos page error:" || args[1] !== fixtureError) original(...args);
    });
    return () => log.mockRestore();
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Something went wrong")).toBeVisible();
    await waitFor(() => expect(console.error).toHaveBeenCalledWith("Combos page error:", fixtureError));
    await userEvent.click(canvas.getByRole("button", { name: "Try again" }));
    await expect(canvas.getByText("Retry requested")).toBeVisible();
    await expect(canvas.queryByText("Something went wrong")).not.toBeInTheDocument();
    await expect(canvas.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
    await expect(canvas.queryByRole("link", { name: "Back to Dashboard" })).not.toBeInTheDocument();
  },
};

/** Retain the actual production error widget; Retry owns the completed reset. */
export const RetainedError = {
  render: Retry.render,
  beforeEach: Retry.beforeEach,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("Something went wrong")).toBeVisible();
    await expect(canvas.getByText("The combos page failed to load. This may happen during hydration in production builds.")).toBeVisible();
    const retry = canvas.getByRole("button", { name: "Try again", exact: true });
    await expect(retry).toBeVisible();
    await expect(retry).toBeEnabled();
    const dashboard = canvas.getByRole("link", { name: "Back to Dashboard", exact: true });
    await expect(dashboard).toBeVisible();
    await expect(dashboard).toHaveAttribute("href", "/dashboard");
    await expect(canvas.queryByText("Retry requested")).not.toBeInTheDocument();
    await waitFor(() => expect(console.error).toHaveBeenCalledWith("Combos page error:", fixtureError));
  },
};
