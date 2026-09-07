import React, { useState } from "react";
import { expect, userEvent, within } from "storybook/test";

import Toggle from "./Toggle.js";

/**
 * Production lane coverage map for `Toggle`. Visual widget lives in the owned
 * production file. Verified owned importers: `endpoint/EndpointPageClient.jsx`,
 * `headroom/HeadroomClient.js`, `media-providers/combo/[id]/page.js`,
 * `media-providers/components/MediaProviderCard.jsx`, `profile/page.js`,
 * `providers/[id]/{ConnectionRow,page}.js`,
 * `providers/components/ConnectionsCard.js`, `proxy-pools/page.js`,
 * `timeline/page.js` (Live toggle), `token-saver/TokenSaverClient.jsx`,
 * `usage/components/ProviderLimits/index.js`, and
 * `shared/components/EditConnectionModal.js`.
 */
const meta = {
  title: "Production/shared-actions/Toggle",
  component: Toggle,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Owned production Toggle. Verified consumers: Endpoint OAuth/Enabled switches, ConnectionRow/ConnectionsCard active toggles, Timeline live toggle, ProviderLimits, MediaProviderCard round-robin, TokenSaverClient. 44px hit target with a compact visual track, RTL-safe knob offset, motion-reduce support.",
      },
    },
  },
  decorators: [(Story) => <div className="w-96"><Story /></div>],
};

export default meta;

export const States = {
  render: () => (
    <div className="space-y-4">
      <Toggle checked ariaLabel="Enabled standalone" />
      <Toggle checked={false} ariaLabel="Disabled standalone" />
      <Toggle checked label="Enable request logging" description="Save request metadata for troubleshooting." />
      <Toggle checked={false} disabled label="Disabled setting" description="Unavailable while this connection is offline." />
      <div className="flex items-center gap-3">
        <Toggle size="sm" checked ariaLabel="Small toggle" />
        <Toggle size="md" checked ariaLabel="Default toggle" />
        <Toggle size="lg" checked ariaLabel="Large toggle" />
      </div>
    </div>
  ),
};

export const ConnectionRowActiveSwitch = {
  name: "ConnectionRow / ConnectionsCard active switch",
  render: () => <Toggle size="sm" checked ariaLabel="Disable connection" />,
};

export const TimelineLiveToggle = {
  name: "Timeline live updates",
  render: () => <Toggle checked ariaLabel="Live timeline updates" />,
};

function WorkingToggle() {
  const [enabled, setEnabled] = useState(false);
  return (
    <div className="space-y-3">
      <Toggle checked={enabled} onChange={setEnabled} label="Live timeline updates" description="Refresh as events arrive." />
      <output aria-live="polite" className="text-[13px] text-dd-muted">{enabled ? "Live updates on" : "Live updates off"}</output>
    </div>
  );
}

export const WorkingState = {
  render: () => <WorkingToggle />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("switch", { name: "Live timeline updates" }));
    await expect(canvas.getByText("Live updates on")).toBeInTheDocument();
  },
};

export const RtlKnob = {
  name: "RTL knob offset (private widget)",
  parameters: { direction: "rtl" },
  render: () => <Toggle checked ariaLabel="RTL checked toggle" />,
};
