import React from "react";
import { expect, fn, spyOn, userEvent, waitFor, within } from "storybook/test";
import MitmError from "./error";

const MITM_ERROR = new Error("Simulated MITM hydration failure");
let errorLog;

export default { title: "Production/operations/MitmError", component: MitmError };
export const Default = {
  args: { error: MITM_ERROR, reset: fn() },
  beforeEach: () => {
    const originalError = console.error;
    errorLog = spyOn(console, "error").mockImplementation((message, error) => {
      if (message !== "MITM page error:" || error !== MITM_ERROR) originalError(message, error);
    });
    return () => errorLog.mockRestore();
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await canvas.findByText("Something went wrong");
    await waitFor(() => expect(errorLog).toHaveBeenCalledWith("MITM page error:", MITM_ERROR));
    await userEvent.click(canvas.getByRole("button", { name: "Try again" }));
    await expect(args.reset).toHaveBeenCalledTimes(1);
  },
};
