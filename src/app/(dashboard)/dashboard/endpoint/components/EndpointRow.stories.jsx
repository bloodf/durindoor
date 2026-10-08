import React, { useState } from "react";
import { expect, userEvent, within } from "storybook/test";

import EndpointRow from "./EndpointRow";

const meta = {
  title: "Production/endpoint/EndpointRow",
  component: EndpointRow,
  parameters: { layout: "padded" },
  args: {
    label: "Local",
    url: "http://localhost:20128/v1",
    copyId: "local_url",
    badge: "",
  },
};

export default meta;

/** Neutral badge, idle copy affordance. */
export const Idle = {};

/** Accent badge for Cloudflare/Tailscale rows once enabled. */
export const AccentBadge = {
  args: { label: "Tunnel", badge: "CF" },
};

/** Activate the real copy control and retain its copied scene for visual proof. */
export const CopyInteraction = {
  render: (args) => {
    function Wrapper() {
      const [copied, setCopied] = useState(null);
      return (
        <EndpointRow
          {...args}
          copied={copied}
          onCopy={(_url, id) => setCopied(id)}
        />
      );
    }
    return <Wrapper />;
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const copyButton = await canvas.findByRole("button", { name: `Copy ${args.label} endpoint`, exact: true });
    await expect(copyButton).toBeVisible();
    await expect(canvas.getByText(args.label, { exact: true })).toBeVisible();
    // Assert the live native URL; real clipboard certification is parent-owned.
    const endpoint = await canvas.findByRole("textbox", { name: `${args.label} endpoint`, exact: true });
    await expect(endpoint).toBeVisible();
    await expect(endpoint).toHaveProperty("readOnly", true);
    await expect(endpoint).toHaveValue(args.url);
    await userEvent.click(copyButton);
  },
};

/** Long URLs retain complete native selection when wrapped; clipboard proof is separate. */
export const LongUrlSelection = {
  ...CopyInteraction,
  args: {
    url: `https://gateway.example.com/${"nested-route/".repeat(24)}v1?client=selection`,
  },
  play: async (context) => {
    await CopyInteraction.play(context);
    const endpoint = within(context.canvasElement).getByRole("textbox", { name: "Local endpoint", exact: true });
    endpoint.focus();
    await expect(endpoint).toHaveFocus();
    endpoint.select();
    await expect(endpoint.selectionStart).toBe(0);
    await expect(endpoint.selectionEnd).toBe(context.args.url.length);
    await expect(endpoint.value.slice(endpoint.selectionStart, endpoint.selectionEnd)).toBe(context.args.url);
  },
};
