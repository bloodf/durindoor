import React from "react";
import { expect, within } from "storybook/test";

import ProviderIcon from "./ProviderIcon";

globalThis.React ??= React;

const meta = {
  title: "Production/shared-provider/ProviderIcon",
  component: ProviderIcon,
  parameters: {
    layout: "centered",
    storyFixture: { scenario: "default", pathname: "/dashboard/providers" },
  },
};

export default meta;

export const ProviderAsset = {
  args: {
    src: "/providers/claude.png",
    alt: "Claude",
    size: 48,
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByAltText("Claude")).toBeInTheDocument();
  },
};

// Private fallback stage: null src renders accessible text tile synchronously.
export const MissingAssetFallback = {
  args: {
    src: null,
    alt: "Unknown provider",
    fallbackText: "U",
    size: 48,
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("img", { name: "Unknown provider" })).toBeInTheDocument();
  },
};
