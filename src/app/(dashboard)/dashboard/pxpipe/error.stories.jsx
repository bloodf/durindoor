import React, { useState } from "react";
import { expect, userEvent, within, waitFor, spyOn } from "storybook/test";
import PxpipeError from "./error";

const PXPIPE_ERROR = new Error("PXPIPE response failed");

function RetryHarness() {
  const [retried, setRetried] = useState(false);
  return <><PxpipeError error={PXPIPE_ERROR} reset={() => setRetried(true)} />{retried ? <p>Retry requested</p> : null}</>;
}

export default {
  title: "Production/pxpipe/PxpipeError",
  component: PxpipeError,
  parameters: { storyFixture: { scenario: "error", pathname: "/dashboard/pxpipe", routes: {} } },
  args: { error: PXPIPE_ERROR, reset: () => {} },
};

export const Retry = {
  render: () => <RetryHarness />,
  beforeEach: () => {
    const original = console.error;
    const log = spyOn(console, "error").mockImplementation((message, error) => {
      if (message !== "PXPIPE page error:" || error !== PXPIPE_ERROR) original(message, error);
    });
    return () => log.mockRestore();
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Try again" }));
    await expect(canvas.getByText("Retry requested")).toBeInTheDocument();
  },
};
