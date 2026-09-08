import React from "react";
import { expect, within } from "storybook/test";
import Footer from "./Footer.js";

/**
 * Production — Footer.
 *
 * The marketing Footer is consumed by `src/app/landing/page.js`. The mark is
 * a tile (emerald accent-soft on a token-driven surface) and the four link
 * groups follow the documented link/heading structure. Stories render against
 * the page background so the border-top hairline and the muted/hover contrast
 * are visible in both palettes.
 */

const meta = {
  title: "Production/Shared-Support/Footer",
  component: Footer,
  parameters: { layout: "fullscreen" },
};

export default meta;

export const Default = {
  render: () => (
    <div className="min-h-[420px] bg-dd-bg">
      <Footer />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("contentinfo")).toBeInTheDocument();
    await expect(canvas.getByRole("heading", { name: "Product" })).toBeInTheDocument();
    await expect(canvas.getByRole("link", { name: "Privacy Policy" })).toBeInTheDocument();
    await expect(canvas.getByLabelText("Twitter")).toBeInTheDocument();
  },
};

export const NarrowViewport = {
  parameters: { viewport: { value: "mobile1" } },
  render: () => (
    <div className="min-h-[640px] bg-dd-bg">
      <Footer />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { name: "Resources" })).toBeInTheDocument();
    await expect(canvas.getByRole("heading", { name: "Company" })).toBeInTheDocument();
  },
};
