import React, { useState } from "react";
import { expect, userEvent, within } from "storybook/test";

import Input from "./Input.js";

/**
 * Production lane coverage map for `Input`. Visual widget lives in the owned
 * production file. Private-widget scenarios exercised below:
 *   - `EditConnectionModal` API key / base URL fields with validation errors.
 *   - `GitLabAuthModal` / `OAuthModal` / `KiroSocialOAuthModal` read-only auth
 *     URL fields (with copy affordance).
 *   - `EndpointPageClient` / `EndpointRow` read-only endpoint URLs.
 *   - `ApiKeyPolicyFields` numeric token/cost limit fields.
 *   - `mcp-gateway` slug/title/command/URL fields with hints.
 */
const meta = {
  title: "Production/shared-actions/Input",
  component: Input,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Owned production Input. Surfaces EditConnectionModal, GitLabAuthModal/OAuthModal read-only auth URLs, EndpointPageClient/EndpointRow read-only endpoints, ApiKeyPolicyFields numeric limits, and mcp-gateway form fields. 44px target, merged aria-describedby with caller-supplied ids, error announced via role=alert.",
      },
    },
  },
  decorators: [(Story) => <div className="w-80"><Story /></div>],
};

export default meta;

export const FormStates = {
  render: () => (
    <div className="space-y-4">
      <Input label="Search models" icon="search" placeholder="provider/model-id" hint="Search covers enabled provider models." />
      <Input label="API key" type="password" required defaultValue="sk-invalid" error="This key failed validation." />
      <Input label="Read-only endpoint" value="https://llm.example.test/v1" readOnly inputClassName="font-mono" />
      <Input label="Disabled key" disabled defaultValue="sk-prod-key" />
    </div>
  ),
};

export const EditConnectionModalFields = {
  name: "EditConnectionModal fields",
  render: () => (
    <div className="space-y-4">
      <Input label="Base URL" required defaultValue="https://api.example.com/v1" error="Must start with https://" />
      <Input label="API key" type="password" required placeholder="sk_durindoor or a saved secret" />
    </div>
  ),
};

export const ReadOnlyAuthUrl = {
  name: "GitLabAuthModal / OAuthModal read-only URL",
  render: () => (
    <Input value="https://gitlab.example.com/oauth/authorize?client_id=…" readOnly className="w-96" inputClassName="font-mono text-xs" aria-label="Authorization URL" />
  ),
};

export const NumericPolicyLimits = {
  name: "ApiKeyPolicyFields numeric limits",
  render: () => (
    <div className="grid grid-cols-2 gap-3">
      <Input label="Lifetime token limit" type="number" min="0" placeholder="Unlimited" />
      <Input label="Lifetime cost limit (USD)" type="number" min="0" step="0.01" placeholder="Unlimited" />
    </div>
  ),
};

function WorkingInput() {
  const [query, setQuery] = useState("");
  return (
    <div className="space-y-3">
      <Input label="Filter" value={query} onChange={(event) => setQuery(event.target.value)} icon="search" placeholder="Find model" />
      <output aria-live="polite" className="text-[13px] text-dd-muted">{query || "No filter"}</output>
    </div>
  );
}

export const WorkingValue = {
  render: () => <WorkingInput />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByLabelText("Filter"), "claude");
    await expect(canvas.getByText("claude")).toBeInTheDocument();
  },
};
