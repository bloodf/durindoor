import React from "react";
import { expect, fn, userEvent, within } from "storybook/test";

import TranslatorError from "./error";

const meta = {
  title: "Production/translator/TranslatorError",
  component: TranslatorError,
  parameters: {
    layout: "fullscreen",
    storyFixture: { scenario: "default", pathname: "/dashboard/translator", params: {}, routes: {} },
  },
  args: { reset: fn() },
};

export default meta;

export const ErrorBoundary = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Retry" }));
    await expect(args.reset).toHaveBeenCalledTimes(1);
  },
};
