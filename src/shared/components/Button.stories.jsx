import React, { useState } from "react";
import { expect, userEvent, within } from "storybook/test";

import Button from "./Button.js";

/**
 * Production lane coverage map for `Button`. Visual widget lives in the owned
 * production file.
 *
 * Verified owned importers (barrel `@/shared/components`):
 *   - Dashboard pages: `auto-configure/AutoConfigureClient.js`,
 *     `combos/page.js`, `console-log/ConsoleLogClient.js`,
 *     `endpoint/EndpointPageClient.jsx`, `headroom/HeadroomClient.js`,
 *     `health/page.js`, `media-providers/...` (4 pages), `playground`,
 *     `profile/page.js`, `providers/[id]/...` (8 files), `proxy-pools/page.js`,
 *     `pxpipe/PxpipeClient.js`, `timeline/[id]/page.js`, `token-saver/...`,
 *     `translator/page.js`, `usage/page.js`, `login/page.js`.
 *   - `cli-tools/components/*ToolCard.js` (16 tool cards: Antigravity, Claude,
 *     Cline, Codex, Copilot, Cowork, DeepSeekTui, Droid, GrokBuild, Hermes,
 *     Jcode, Kilo, MitmServer, MitmTool, OpenClaw, OpenCode).
 *   - `shared/components/`: `AddCustomEmbeddingModal`, `CursorAuthModal`,
 *     `EditConnectionModal`, `GitLabAuthModal`, `IFlowCookieModal`,
 *     `ImportTokenModal`, `KiroAuthModal`, `KiroSocialOAuthModal`,
 *     `OAuthModal`, `SetupDiagnosticCard`.
 *   - `usage/components/RequestDetailsTab.js` (per-request drawer actions).
 */
const meta = {
  title: "Production/shared-actions/Button",
  component: Button,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Owned production Button — primary emerald, secondary neutral, outline transparent, ghost quiet, danger destructive, legacy success mapped to emerald (no success-action token in DS). Verified owned importers listed in the file header. 44px touch targets, focus ring, motion-reduce safe, loading spinner.",
      },
    },
  },
  args: { children: "Save changes" },
};

export default meta;

export const Variants = {
  render: () => (
    <div className="flex flex-wrap gap-3">
      <Button variant="primary" icon="save">Apply</Button>
      <Button variant="secondary">Cancel</Button>
      <Button variant="outline">Preview</Button>
      <Button variant="ghost">More</Button>
      <Button variant="danger" icon="delete">Delete</Button>
      <Button variant="success" icon="check">Complete</Button>
    </div>
  ),
};

export const SizesAndLoading = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button size="sm">Small</Button>
      <Button size="md">Default</Button>
      <Button size="lg" iconRight="arrow_forward">Continue</Button>
      <Button loading>Saving</Button>
    </div>
  ),
};

export const ModalAndAuthActions = {
  name: "Modal / auth CTA pairs (EditConnectionModal, GitLabAuthModal, OAuthModal)",
  render: () => (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <Button variant="primary">Save changes</Button>
        <Button variant="ghost">Cancel</Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="danger" icon="delete">Delete connection</Button>
        <Button variant="secondary">Keep connection</Button>
      </div>
      <Button variant="primary" fullWidth icon="login">Sign in</Button>
    </div>
  ),
};

export const ToolCardApplyResetManualConfig = {
  name: "cli-tools ToolCard Apply / Reset / Manual Config triple",
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Button variant="primary" size="sm" icon="save">Apply</Button>
      <Button variant="outline" size="sm" icon="restore">Reset</Button>
      <Button variant="ghost" size="sm" icon="content_copy">Manual Config</Button>
    </div>
  ),
};

function ActionDemo() {
  const [saved, setSaved] = useState(false);
  return (
    <div className="w-72 space-y-3">
      <Button fullWidth icon="save" onClick={() => setSaved(true)}>Save settings</Button>
      <output aria-live="polite" className="text-[13px] text-dd-muted">{saved ? "Saved" : "Unsaved"}</output>
    </div>
  );
}

export const WorkingAction = {
  render: () => <ActionDemo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Save settings" }));
    await expect(canvas.getByText("Saved")).toBeInTheDocument();
  },
};
