import React from "react";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import AddApiKeyModal from "./AddApiKeyModal";
import AddCustomModelModal from "./AddCustomModelModal";
import BulkImportCodexModal from "./BulkImportCodexModal";
import BulkImportGrokCliModal from "./BulkImportGrokCliModal";
import CompatibleModelsSection from "./CompatibleModelsSection";
import ConnectionRow from "./ConnectionRow";
import EditCompatibleNodeModal from "./EditCompatibleNodeModal";
import PassthroughModelsSection from "./PassthroughModelsSection";
import ProviderDetailError from "./error";

const noop = fn();
const fixtureError = new Error("Fixture error");
let fixtureConsoleErrorCount = 0;
const connection = {
  id: "oc-prod-main",
  provider: "oc-prod",
  authType: "apikey",
  name: "Production",
  isActive: true,
  testStatus: "active",
  priority: 1,
  providerSpecificData: {},
};

// Absolute ISO keeps the private CooldownTimer rendered without depending on
// a relative Date.now(). The story pins Date.now to a known epoch so the
// derived "remaining" is deterministic between render and assertion. The
// mutable `cooldownNowMs` lets the play step advance past expiry and let
// CooldownTimer's 1s interval observe the transition.
let cooldownNowMs = Date.parse("2099-06-01T00:00:00.000Z");
const COOLDOWN_EPOCH_MS = cooldownNowMs;
const COOLDOWN_UNTIL_ISO = "2099-06-01T00:05:00.000Z";
const cooldownConnection = {
  ...connection,
  id: "oc-prod-cooldown",
  name: "Cooling down",
  testStatus: "unavailable",
  "modelLock_gpt-5": COOLDOWN_UNTIL_ISO,
};

const modelRoutes = {
  "POST /api/models/test": { body: { ok: true } },
  "POST /api/models/custom": { body: { model: { id: "gpt-custom", providerAlias: "oc-prod", type: "llm" } } },
  "DELETE /api/models/custom": { body: { ok: true } },
  "POST /api/models/test/batch": { body: "data: {\"model\":\"oc-prod/gpt-custom\",\"ok\":true}\n\ndata: {\"done\":true}\n\n", events: true },
};

const meta = {
  title: "Production/providers/detail/Widgets",
  parameters: {
    layout: "padded",
  storyFixture: { scenario: "default", pathname: "/dashboard/providers/oc-prod", params: { id: "oc-prod" }, routes: modelRoutes },
  },
};

export default meta;

/** Real connection row, including action buttons, proxy menu, status badges, error/cooldown paths. */
export const ConnectionRowScenario = {
  render: () => <ConnectionRow connection={connection} providerId="oc-prod" proxyPools={[{ id: "pool-a", name: "EU Pool", isActive: true, proxyUrl: "https://proxy.example.test" }]} isOAuth={false} isFirst={false} isLast={false} onMoveUp={noop} onMoveDown={noop} onToggleActive={noop} onUpdateProxy={noop} onEdit={noop} onDelete={noop} />,
};

/**
 * Real connection row pinned in cooldown via a fixed epoch clock. `beforeEach`
 * patches Date.now before the component mounts (both ConnectionRow's own
 * cooldown check and CooldownTimer read it), so the initial render sees a
 * deterministic "5m 0s" instead of a huge/negative diff against the real
 * host clock. The `play` step then advances the mutable epoch past
 * expiry and waits for CooldownTimer's own 1s interval to re-render and
 * remove itself, proving the private widget's live transition.
 */

export const ConnectionRowCooldown = {
  render: () => <ConnectionRow connection={cooldownConnection} providerId="oc-prod" proxyPools={[{ id: "pool-a", name: "EU Pool", isActive: true, proxyUrl: "https://proxy.example.test" }]} isOAuth={false} isFirst={false} isLast={false} onMoveUp={noop} onMoveDown={noop} onToggleActive={noop} onUpdateProxy={noop} onEdit={noop} onDelete={noop} />,
  beforeEach: async () => {
    const originalNow = Date.now;
    cooldownNowMs = COOLDOWN_EPOCH_MS;
    Date.now = () => cooldownNowMs;
    return () => {
      Date.now = originalNow;
    };
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const status = await canvas.findByText(/Cooling down/i);
    await expect(status).toBeVisible();
    // Fixed 5-minute lock at the pinned epoch: deterministic "5m 0s" branch.
    const countdown = await canvas.findByText(/5m\s+0s/);
    await expect(countdown).toBeVisible();

    // Advance the patched clock past expiry. Cleanup happens after Storybook
    // unmounts, so CooldownTimer's private interval never sees a restored
    // real clock mid-test.
    cooldownNowMs = Date.parse(COOLDOWN_UNTIL_ISO) + 1000;
    await waitFor(() => {
      expect(countdown).not.toBeInTheDocument();
      expect(canvas.getByText("active", { exact: true })).toBeVisible();
    }, { timeout: 2500 });
  },
};

/** Compatible section is public parent coverage for private CompatibleModelRow and its select/bulk/action scenarios. */
export const CompatibleModels = {
  render: () => <CompatibleModelsSection providerStorageAlias="oc-prod" providerDisplayAlias="oc-prod" modelAliases={{}} customModels={[{ id: "gpt-custom", providerAlias: "oc-prod", type: "llm" }]} copied="" onCopy={noop} onDeleteAlias={noop} onAddCustomModel={noop} onDeleteCustomModel={noop} onEditCustomModel={noop} onRefresh={noop} connections={[connection]} isAnthropic={false} />,
};

/** Passthrough section is public parent coverage for private PassthroughModelRow. */
export const PassthroughModels = {
  render: () => <PassthroughModelsSection providerAlias="openrouter" modelAliases={{}} customModels={[{ id: "openai/gpt-4o", providerAlias: "openrouter", type: "llm" }]} copied="" onCopy={noop} onDeleteAlias={noop} onAddCustomModel={noop} onDeleteCustomModel={noop} onRefresh={noop} />,
};

/** Private modals are rendered with real forms and their request descriptors. */
export const AddApiKey = {
  render: () => <AddApiKeyModal isOpen provider="oc-prod" providerName="Compatible" isCompatible isAnthropic={false} authType="apikey" proxyPools={[]} existingConnectionNames={[]} onSave={noop} onBulkDone={noop} onClose={noop} />,
  play: async () => {
    const body = within(document.body);
    await expect(await body.findByRole("dialog", { name: /add compatible api key/i })).toBeVisible();
  },
};

export const AddCustomModel = {
  render: () => <AddCustomModelModal isOpen providerAlias="oc-prod" providerDisplayAlias="Compatible" onSave={noop} onClose={noop} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(document.body);
    const dialog = await body.findByRole("dialog", { name: /add custom model/i });
    await expect(dialog).toBeVisible();
    await userEvent.click(await within(dialog).findByRole("button", { name: "Advanced" }));
    await expect(await within(dialog).findByLabelText("Thinking format")).toBeInTheDocument();
  },
};

export const CompatibleEdit = {
  render: () => <EditCompatibleNodeModal isOpen node={{ id: "oc-prod", name: "Compatible", prefix: "oc-prod", apiType: "chat", baseUrl: "https://api.openai.com/v1" }} onSave={noop} onClose={noop} isAnthropic={false} />,
  play: async () => {
    const body = within(document.body);
    await expect(await body.findByRole("dialog", { name: /edit openai compatible/i })).toBeVisible();
  },
};

export const BulkImports = {
  render: () => <div className="flex gap-4"><BulkImportCodexModal isOpen onClose={noop} onSuccess={noop} /><BulkImportGrokCliModal isOpen onClose={noop} onSuccess={noop} /></div>,
  play: async () => {
    const body = within(document.body);
    await expect(await body.findByRole("dialog", { name: /bulk add codex accounts/i })).toBeVisible();
    await expect(await body.findByRole("dialog", { name: /bulk add grok cli accounts/i })).toBeVisible();
  },
};

export const ErrorState = {
  beforeEach: () => {
    const originalConsoleError = console.error;
    fixtureConsoleErrorCount = 0;
    console.error = (...args) => {
      if (args[0] === "Provider detail page error:" && args[1] === fixtureError) {
        fixtureConsoleErrorCount += 1;
        return;
      }
      originalConsoleError(...args);
    };
    return () => {
      console.error = originalConsoleError;
    };
  },
  render: () => <ProviderDetailError error={fixtureError} reset={noop} />,
  play: async () => {
    await waitFor(() => expect(fixtureConsoleErrorCount).toBe(1));
  },
};
