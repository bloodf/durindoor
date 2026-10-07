import React, { useState } from "react";
import { expect, userEvent, within, spyOn } from "storybook/test";
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
    const log = spyOn(console, "error").mockImplementation((message, error) => {
      if (message !== "Combos page error:" || error !== fixtureError) original(message, error);
    });
    return () => log.mockRestore();
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Something went wrong")).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Try again" }));
    await expect(canvas.getByText("Retry requested")).toBeVisible();
  },
};
