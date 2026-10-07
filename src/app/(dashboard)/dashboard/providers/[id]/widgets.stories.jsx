import React from "react";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import AddApiKeyModal from "./AddApiKeyModal";
import AddCustomModelModal from "./AddCustomModelModal";
import BulkImportCodexModal from "./BulkImportCodexModal";
import BulkImportGrokCliModal from "./BulkImportGrokCliModal";
import CompatibleModelsSection from "./CompatibleModelsSection";
import ConnectionRow from "./ConnectionRow";
import EditCompatibleNodeModal from "./EditCompatibleNodeModal";
import ModelAutoSyncPanel from "./ModelAutoSyncPanel";
import PassthroughModelsSection from "./PassthroughModelsSection";
import ProviderDetailError from "./error";
import ProviderErrorRulesModal from "./ProviderErrorRulesModal";
import VisibleModelsModal from "./VisibleModelsModal";

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

export const AddWebCookie = {
  parameters: { storyFixture: { routes: {
    "POST /api/providers/web-login/start": { status: 503, body: { error: "Configure a separate login origin." } },
  } } },
  render: () => <AddApiKeyModal isOpen provider="grok-web" providerName="Grok Web" authType="cookie" webLogin={{}} proxyPools={[]} existingConnectionNames={[]} onSave={noop} onBulkDone={noop} onClose={noop} />,
  play: async () => {
    const body = within(document.body);
    await userEvent.click(await body.findByRole("button", { name: "Sign in in-page" }));
    const login = await body.findByRole("dialog", { name: "Sign in to Grok Web" });
    await expect(await within(login).findByRole("alert")).toHaveTextContent("Configure a separate login origin.");
    await userEvent.click(within(login).getByRole("button", { name: "Cancel" }));
    await expect(await body.findByRole("dialog", { name: "Add Grok Web Cookie Value" })).toBeVisible();
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

/** API-key form covers bulk planning success and preflight-safe failure with real request handlers. */
export const ApiKeyBulkAndValidation = {
  parameters: { storyFixture: { routes: {
    "GET /api/providers": { body: { connections: [{ id: "existing", provider: "openai", authType: "apikey", name: "Key 1" }] } },
    "POST /api/providers": { body: { connection: { id: "created" } } },
    "POST /api/providers/validate": { body: { valid: false } },
  } } },
  render: () => <AddApiKeyModal isOpen provider="openai" providerName="OpenAI" authType="apikey" proxyPools={[]} existingConnectionNames={["Key 1"]} onSave={noop} onBulkDone={noop} onClose={noop} />,
  play: async () => {
    const body = within(document.body);
    const dialog = await body.findByRole("dialog", { name: "Add OpenAI API Key" });
    await userEvent.type(within(dialog).getByLabelText("API Key"), "sk-example");
    await userEvent.click(within(dialog).getByRole("button", { name: "Check" }));
    await expect(await within(dialog).findByText("Invalid")).toBeVisible();
    await userEvent.click(within(dialog).getByRole("button", { name: "Bulk Add" }));
    await userEvent.type(within(dialog).getByLabelText("Credentials"), "Key|sk-example");
    await userEvent.click(within(dialog).getByRole("button", { name: "Add All Keys" }));
    await expect(await within(dialog).findByText("1 added")).toBeVisible();
  },
};

/** Custom-model advanced form keeps capability and thinking controls visible. */
export const AddCustomModelAdvanced = {
  render: () => <AddCustomModelModal isOpen providerAlias="oc-prod" providerDisplayAlias="Compatible" initialModel={{ id: "gpt-example", capabilities: { tools: true, thinkingFormat: "openai" } }} onSave={noop} onClose={noop} />,
  play: async () => {
    const dialog = await within(document.body).findByRole("dialog", { name: /edit custom model/i });
    await expect(within(dialog).getByLabelText("Thinking format")).toBeVisible();
  },
};

/** Live allowlist mixes upstream-only, stale selected, registry, and always-visible custom rows. */
export const VisibleModels = {
  parameters: { storyFixture: { routes: {
    "GET /api/models/enabled?providerAlias=oc-prod": { body: { ids: ["stale-model"] } },
    "GET /api/providers/oc-prod-main/models": { body: { models: [{ id: "live-model", name: "Live model" }] } },
    "PUT /api/models/enabled": { body: { ok: true } },
  } } },
  render: () => <VisibleModelsModal isOpen providerId="openai" providerAlias="oc-prod" connections={[connection]} customModels={[{ id: "custom-model", providerAlias: "oc-prod" }]} disabledModelIds={[]} onSaved={noop} onClose={noop} />,
  play: async () => {
    const dialog = await within(document.body).findByRole("dialog", { name: "Visible models" });
    await expect(await within(dialog).findByText("Live model")).toBeVisible();
    await expect(within(dialog).getByText("not in catalog")).toBeVisible();
    await expect(within(dialog).getByText("custom-model")).toBeVisible();
  },
};

/** Error-rule dialog rejects invalid draft, then adds an explicit scoped cooldown rule. */
export const ProviderErrorRules = {
  render: () => <ProviderErrorRulesModal isOpen providerId="oc-prod" rules={[]} onSave={noop} onClose={noop} />,
  play: async () => {
    const dialog = await within(document.body).findByRole("dialog", { name: "Provider Error Rules" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Add Rule" }));
    await expect(await within(dialog).findByRole("alert")).toHaveTextContent("Match text is required");
    await userEvent.type(within(dialog).getByLabelText("Match (substring, case-insensitive)"), "daily cap");
    await userEvent.type(within(dialog).getByLabelText("Cooldown seconds (optional)"), "30");
    await userEvent.click(within(dialog).getByRole("button", { name: "Add Rule" }));
    await expect(await within(dialog).findByText('429 contains "daily cap"')).toBeVisible();
  },
};

/** Auto-sync panel exposes eligible saved, changed-catalog, and failed-last-attempt state. */
export const ModelAutoSync = {
  parameters: { storyFixture: { routes: {
    "GET /api/models/auto-sync?provider=openai": { body: { providers: { openai: { eligible: true, enabled: true, models: ["gpt-live"], syncedAt: "2026-01-01T00:00:00.000Z", newModelIds: ["gpt-live"], removedModelIds: ["gpt-retired"], error: "Upstream timeout" } } } },
    "POST /api/models/auto-sync": { body: { results: [{ status: "synced", modelCount: 1 }] } },
  } } },
  render: () => <ModelAutoSyncPanel providerId="openai" hasConnection onModelsChange={noop} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("New: gpt-live")).toBeVisible();
    await expect(canvas.getByText("Removed in last sync: gpt-retired")).toBeVisible();
    await expect(canvas.getByText("Last attempt failed: Upstream timeout")).toBeVisible();
  },
};

/** ChatGPT web-cookie helper exposes copyable browser extraction instructions. */
export const ChatgptWebCookie = {
  render: () => <AddApiKeyModal isOpen provider="chatgpt-web" providerName="ChatGPT Web" authType="cookie" authHint="Paste a session cookie." proxyPools={[]} existingConnectionNames={[]} onSave={noop} onBulkDone={noop} onClose={noop} />,
  play: async () => {
    const dialog = await within(document.body).findByRole("dialog", { name: "Add ChatGPT Web Cookie Value" });
    await expect(within(dialog).getByTestId("chatgpt-web-cookie-steps")).toBeVisible();
    await expect(within(dialog).getByRole("button", { name: "Copy snippet" })).toBeVisible();
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
