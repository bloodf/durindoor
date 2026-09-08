import React from "react";
import { expect, within } from "storybook/test";

import SecurityWarning from "./SecurityWarning";

const meta = {
  title: "Production/endpoint/SecurityWarning",
  component: SecurityWarning,
  parameters: { layout: "padded" },
};

export default meta;

/** Message only, no action link. */
export const MessageOnly = {
  args: { message: "Endpoint is exposed without an API key." },
};

/** External link action. */
export const WithLinkAction = {
  args: {
    message: "Require login is disabled — anyone can access your dashboard via tunnel.",
    action: { label: "Enable", href: "/dashboard/profile" },
  },
};

/** In-page anchor action remains focusable and retains its scroll target. */
export const WithAnchorAction = {
  args: {
    message: "Require API key is disabled — your endpoint is publicly accessible without authentication.",
    action: { label: "Enable", href: "#require-api-key" },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const link = await canvas.findByRole("link", { name: "Enable" });
    await expect(link).toHaveAttribute("href", "#require-api-key");
    link.focus();
    await expect(link).toHaveFocus();
  },
};
