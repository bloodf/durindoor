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

/** Copy button reflects copied state and the inner icon flips to `check`. */
export const CopyInteraction = {
  render: (args) => {
    function Wrapper() {
      const [copied, setCopied] = useState(null);
      return (
        <EndpointRow
          {...args}
          copied={copied}
          onCopy={(url, id) => setCopied(id)}
        />
      );
    }
    return <Wrapper />;
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const copyButton = await canvas.findByRole("button", { name: "Copy Local endpoint" });
    const iconBefore = copyButton.querySelector(".material-symbols-outlined");
    await expect(iconBefore?.textContent).toBe("content_copy");
    await userEvent.click(copyButton);
    const iconAfter = copyButton.querySelector(".material-symbols-outlined");
    await expect(iconAfter?.textContent).toBe("check");
  },
};
