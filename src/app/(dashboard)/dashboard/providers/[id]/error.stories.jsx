import React from "react";
import { expect, fn, userEvent, within } from "storybook/test";
import ProviderDetailError from "./error";

export default {
  title: "Production/providers/ProviderDetailError",
  component: ProviderDetailError,
  args: { error: new Error("Expected story error"), reset: fn() },
  parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/providers/openai", routes: {} } },
  beforeEach: () => {
    const original = console.error;
    console.error = (...args) => { if (args[0] !== "Provider detail page error:") original(...args); };
    return () => { console.error = original; };
  },
};
export const ErrorBoundary = { play: async ({ args }) => {
  const alert = within(document.body).getByRole("alert");
  await userEvent.click(within(alert).getByRole("button", { name: "Try again" }));
  await expect(args.reset).toHaveBeenCalledTimes(1);
} };
