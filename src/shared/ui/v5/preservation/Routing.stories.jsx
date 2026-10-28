import React, { useCallback, useState } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import Button from "@/shared/ui/components/Button.jsx";
import XiaomiMimoAuthModal from "@/shared/components/XiaomiMimoAuthModal.js";
import GheCopilotAuthModal from "@/shared/components/GheCopilotAuthModal.js";
import OrcaRouterAuthModal from "@/shared/components/OrcaRouterAuthModal.js";
import EditConnectionModal from "@/shared/components/EditConnectionModal.js";
import AddApiKeyModal from "@/app/(dashboard)/dashboard/providers/[id]/AddApiKeyModal.js";
import VisibleModelsModal from "@/app/(dashboard)/dashboard/providers/[id]/VisibleModelsModal.js";
import ProviderErrorRulesModal from "@/app/(dashboard)/dashboard/providers/[id]/ProviderErrorRulesModal.js";
import ModelAutoSyncPanel from "@/app/(dashboard)/dashboard/providers/[id]/ModelAutoSyncPanel.js";
import KeysPageClient from "@/app/(dashboard)/dashboard/keys/KeysPageClient.jsx";
import EndpointPageClient from "@/app/(dashboard)/dashboard/endpoint/EndpointPageClient.jsx";
import CombosPage from "@/app/(dashboard)/dashboard/combos/page.js";
import MediaRoutesPage from "@/app/(dashboard)/dashboard/media-routes/page.js";
import ProxyPoolsPage from "@/app/(dashboard)/dashboard/proxy-pools/page.js";
import ConnectionGroupsPanel from "@/app/(dashboard)/dashboard/combos/ConnectionGroupsPanel.jsx";
import { createRoutingFixture, ROUTING_CONNECTION, ROUTING_KEY } from "./routing-fixtures.js";

/** Every form below is the production component. Adapters only supply its parent callbacks. */
const meta = { title: "Preservation/Routing", parameters: { layout: "fullscreen" } };
export default meta;

const bodyScope = () => within(document.body);
async function dialog(name) {
  const element = await bodyScope().findByRole("dialog", { name });
  await waitFor(() => expect(element).toBeVisible());
  await waitFor(() => expect(element.querySelector("section") || element).toBeVisible());
  return within(element);
}
async function replace(input, value) { await userEvent.clear(input); await userEvent.type(input, value); }
async function choose(scope, name, option) {
  await userEvent.click(scope.getByLabelText(name));
  await userEvent.click(await bodyScope().findByRole("option", { name: option }));
}
function story(render, options = {}, play) {
  const fixture = createRoutingFixture(options);
  const scenario = {
    render: () => render(fixture),
    parameters: { storyFixture: { scenario: "default", pathname: options.pathname || "/dashboard/providers", params: {}, routes: fixture.routes, externalFixtures: fixture.externalFixtures } },
    beforeEach: () => {
      fixture.reset();
      if (!options.popup) return undefined;
      const original = window.open;
      window.open = () => ({ closed: false, close() {}, focus() {} });
      return () => { window.open = original; };
    },
  };
  if (play) scenario.play = async (context) => play(fixture, context);
  return scenario;
}
function AuthReview({ Component, ...props }) {
  const [open, setOpen] = useState(true);
  const [saved, setSaved] = useState(false);
  return <><Component {...props} isOpen={open} onSuccess={() => setSaved(true)} onClose={() => setOpen(false)} />{saved && <p role="status">Review account connected</p>}</>;
}
function AccountReview({ provider = "openai", editing = false, connections = [ROUTING_CONNECTION] }) {
  const [open, setOpen] = useState(true);
  const [selected, setSelected] = useState(0);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const connection = connections[selected];
  const save = async (payload) => {
    const response = await fetch(editing ? `/api/providers/${connection.id}` : "/api/providers", {
      method: editing ? "PUT" : "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editing ? payload : { provider, authType: "apikey", ...payload }),
    });
    const result = await response.json();
    if (!response.ok) { setError(result.error); return; }
    setMessage(`Saved ${result.connection.name}`); setOpen(false);
  };
  return <>
    {!open && <Button onClick={() => setOpen(true)}>Edit review account</Button>}
    {editing && connections.length > 1 && <Button onClick={() => setSelected((value) => (value + 1) % connections.length)}>Switch review account</Button>}
    {editing
      ? <EditConnectionModal isOpen={open} connection={connection} onSave={save} onClose={() => setOpen(false)} />
      : <AddApiKeyModal isOpen={open} provider={provider} providerName={provider} authType="apikey" proxyPools={[]} existingConnectionNames={[]} onSave={save} onBulkDone={() => setMessage("Imported review accounts")} onClose={() => setOpen(false)} error={error} />}
    {message && <p role="status">{message}</p>}
  </>;
}
function RulesReview() {
  const [open, setOpen] = useState(true);
  const [saved, setSaved] = useState(false);
  const save = async (rules) => {
    const settings = await fetch("/api/settings").then((response) => response.json());
    const response = await fetch("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ providerErrorRules: { ...settings.providerErrorRules, openai: rules } }) });
    if (!response.ok) throw new Error((await response.json()).error);
    setSaved(true);
  };
  return <><ProviderErrorRulesModal isOpen={open} providerId="openai" rules={[]} onSave={save} onClose={() => setOpen(false)} />{saved && <p role="status">Provider error rules saved</p>}</>;
}
const VISIBLE_CONNECTIONS = [ROUTING_CONNECTION];
const CUSTOM_MODELS = [{ id: "review-custom", providerAlias: "openai" }];
function VisibilityReview() {
  const [open, setOpen] = useState(true);
  const [saved, setSaved] = useState(false);
  return <><VisibleModelsModal isOpen={open} onClose={() => setOpen(false)} providerId="openai" providerAlias="openai" connections={VISIBLE_CONNECTIONS} customModels={CUSTOM_MODELS} disabledModelIds={[]} onSaved={() => setSaved(true)} />{saved && <p role="status">Visible models saved</p>}</>;
}
function SyncReview() {
  const [models, setModels] = useState(null);
  const onModelsChange = useCallback((value) => setModels(value), []);
  return <><ModelAutoSyncPanel providerId="openai" hasConnection onModelsChange={onModelsChange} /><p>{models?.length || 0} effective models</p></>;
}

export const MimoDesktopFound = story(() => <AuthReview Component={XiaomiMimoAuthModal} />, { mimoFound: true });
export const MimoDesktopMissing = story(() => <AuthReview Component={XiaomiMimoAuthModal} />);
export const MimoDesktopDetecting = story(() => <AuthReview Component={XiaomiMimoAuthModal} />, { pending: ["GET /api/oauth/xiaomi-mimo/auto-import"] });
export const MimoLocalImportSuccess = story(() => <AuthReview Component={XiaomiMimoAuthModal} />, { mimoFound: true }, async (fixture) => {
  const scope = await dialog("Connect Xiaomi MiMo");
  await userEvent.click(await scope.findByRole("button", { name: "Connect with local credentials" }));
  await expect(await bodyScope().findByText("Review account connected")).toBeVisible();
  expect(fixture.snapshot().writes.at(-1).payload).toMatchObject({ apiKey: "SYNTHETIC_MIMO", mimoUserId: "review-mimo-user", mimoCUserId: "review-mimo-cuser" });
});
export const MimoLocalImportFailure = story(() => <AuthReview Component={XiaomiMimoAuthModal} />, { mimoFound: true, failures: { "POST /api/oauth/xiaomi-mimo/api-key": "Review credential import failed" } }, async () => {
  const scope = await dialog("Connect Xiaomi MiMo");
  await userEvent.click(await scope.findByRole("button", { name: "Connect with local credentials" }));
  await expect(await scope.findByRole("alert")).toHaveTextContent("Review credential import failed");
});
export const MimoLocalImportPending = story(() => <AuthReview Component={XiaomiMimoAuthModal} />, { mimoFound: true, pending: ["POST /api/oauth/xiaomi-mimo/api-key"] }, async () => {
  const scope = await dialog("Connect Xiaomi MiMo");
  await userEvent.click(await scope.findByRole("button", { name: "Connect with local credentials" }));
  await expect(await scope.findByText("Connecting...")).toBeVisible();
});
export const MimoClusterChoices = story(() => <AuthReview Component={XiaomiMimoAuthModal} />, {}, async () => {
  const scope = await dialog("Connect Xiaomi MiMo");
  await userEvent.click(await scope.findByRole("button", { name: "Choose cluster & sign in" }));
  await expect(scope.getByRole("button", { name: /Singapore/ })).toBeVisible();
});
export const MimoBrowserWaiting = story(() => <AuthReview Component={XiaomiMimoAuthModal} />, { popup: true }, async (fixture) => {
  const scope = await dialog("Connect Xiaomi MiMo");
  await userEvent.click(await scope.findByRole("button", { name: "Choose cluster & sign in" }));
  await userEvent.click(scope.getByRole("button", { name: /Singapore/ }));
  await expect(await scope.findByText("Waiting for login...")).toBeVisible();
  expect(fixture.snapshot().writes.at(-1).payload).toEqual({ region: "sgp" });
});
export const MimoBrowserStartFailure = story(() => <AuthReview Component={XiaomiMimoAuthModal} />, { failures: { "POST /api/oauth/xiaomi-mimo/login/start": "Review login unavailable" } }, async () => {
  const scope = await dialog("Connect Xiaomi MiMo");
  await userEvent.click(await scope.findByRole("button", { name: "Choose cluster & sign in" }));
  await userEvent.click(scope.getByRole("button", { name: /Singapore/ }));
  await expect(await scope.findByRole("alert")).toHaveTextContent("Review login unavailable");
});
const ghe = () => <AuthReview Component={GheCopilotAuthModal} providerInfo={{ name: "GitHub Enterprise Copilot" }} proxyPools={[]} proxyPoolsReady />;
export const EnterpriseHost = story(ghe);
export const EnterpriseInvalidHost = story(ghe, {}, async () => {
  const scope = await dialog("Connect GitHub Enterprise Copilot");
  await userEvent.type(scope.getByLabelText("GitHub Enterprise URL"), "http://ghe.example.test");
  await userEvent.click(scope.getByRole("button", { name: "Continue" }));
  await expect(await scope.findByText(/Enter an https URL/)).toBeVisible();
});
export const EnterpriseDeviceCode = story(ghe, { popup: true }, async (fixture) => {
  const scope = await dialog("Connect GitHub Enterprise Copilot");
  await userEvent.type(scope.getByLabelText("GitHub Enterprise URL"), "https://ghe.example.test/path");
  await userEvent.click(scope.getByRole("button", { name: "Continue" }));
  await waitFor(() => expect(bodyScope().getByText("REVIEW-CODE")).toBeVisible());
  const request = fixture.snapshot().requests.find((item) => item.key === "POST /api/oauth/ghe-copilot/device-code");
  expect(request.payload).toMatchObject({ gheUrl: "https://ghe.example.test" });
});
const orca = () => <AuthReview Component={OrcaRouterAuthModal} providerInfo={{ name: "OrcaRouter" }} />;
export const OrcaAuthenticationMethods = story(orca);
export const OrcaPkceCode = story(orca, {}, async () => {
  const scope = await dialog("Connect OrcaRouter");
  await userEvent.click(scope.getByRole("button", { name: "Sign in with OrcaRouter" }));
  await expect(await scope.findByLabelText("Authorization code")).toBeVisible();
});
export const OrcaPkceSuccess = story(orca, {}, async (fixture) => {
  const scope = await dialog("Connect OrcaRouter");
  await userEvent.click(scope.getByRole("button", { name: "Sign in with OrcaRouter" }));
  await userEvent.type(await scope.findByLabelText("Authorization code"), "SYNTHETIC_CODE");
  await userEvent.click(scope.getByRole("button", { name: "Connect" }));
  await expect(await scope.findByText("Connected. You can close this window.")).toBeVisible();
  expect(fixture.snapshot().writes.at(-1).payload).toEqual({ code: "SYNTHETIC_CODE", state: "review-orca-state", flowId: "review-orca-flow" });
});
export const OrcaPkceFailure = story(orca, { failures: { "POST /api/oauth/orcarouter/exchange": "Review code expired" } }, async () => {
  const scope = await dialog("Connect OrcaRouter");
  await userEvent.click(scope.getByRole("button", { name: "Sign in with OrcaRouter" }));
  await userEvent.type(await scope.findByLabelText("Authorization code"), "SYNTHETIC_CODE");
  await userEvent.click(scope.getByRole("button", { name: "Connect" }));
  await expect(await scope.findByRole("alert")).toHaveTextContent("Review code expired");
  await expect(scope.getByRole("button", { name: "Sign in with OrcaRouter" })).toBeEnabled();
});
export const OrcaReplaceExistingKey = story(orca, { connections: [{ ...ROUTING_CONNECTION, provider: "orcarouter", keyHint: "review-old" }, { ...ROUTING_CONNECTION, id: "review-oauth-account", provider: "orcarouter", authType: "oauth" }] }, async (fixture) => {
  const scope = await dialog("Connect OrcaRouter");
  await userEvent.click(scope.getByTestId("orca-tab-api"));
  await expect(await scope.findByTestId("orca-stored-key")).toBeVisible();
  await userEvent.type(scope.getByLabelText("OrcaRouter API key"), "SYNTHETIC_ORCA_KEY");
  await userEvent.click(scope.getByRole("button", { name: "Save API key" }));
  await waitFor(() => expect(fixture.snapshot().writes.at(-1)?.key).toBe("PUT /api/providers/review-account"));
  expect(fixture.snapshot().connections.find((item) => item.id === "review-oauth-account").apiKey).toBe("SYNTHETIC_REVIEW_SECRET");
});

export const KeylessLocalAccount = story(() => <AccountReview provider="ollama-local" />, { connections: [] }, async (fixture) => {
  const scope = await dialog(/Add ollama-local/);
  await userEvent.type(scope.getByLabelText("Ollama Host URL"), "http://ollama.example.test:11434");
  await userEvent.click(scope.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(fixture.snapshot().connections).toHaveLength(1));
  expect(fixture.snapshot().writes.at(-1).payload).toMatchObject({ provider: "ollama-local", apiKey: "" });
});
export const AwsProfileAccount = story(() => <AccountReview provider="bedrock" />, { connections: [] }, async (fixture) => {
  const scope = await dialog(/Add bedrock/);
  await userEvent.type(scope.getByLabelText("AWS Profile (SSO, recommended)"), "review-sso-profile");
  await userEvent.click(scope.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(fixture.snapshot().writes.at(-1)?.payload.providerSpecificData).toMatchObject({ profile: "review-sso-profile" }));
  expect(fixture.snapshot().writes.at(-1).payload.apiKey).toBe("");
});
export const AwsTemporaryCredentials = story(() => <AccountReview provider="bedrock" />, { connections: [] }, async (fixture) => {
  const scope = await dialog(/Add bedrock/);
  await userEvent.type(scope.getByLabelText("Access Key ID (static AWS keys only)"), "ASIA_REVIEW_ONLY");
  await userEvent.type(scope.getByLabelText(/Secret Access Key|API Key/), "SYNTHETIC_AWS_SECRET");
  await userEvent.type(scope.getByLabelText("Session Token (temporary ASIA... keys only)"), "SYNTHETIC_AWS_SESSION");
  await userEvent.click(scope.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(fixture.snapshot().writes.at(-1)?.payload.sessionToken).toBe("SYNTHETIC_AWS_SESSION"));
  expect(fixture.snapshot().writes.at(-1).payload.providerSpecificData).not.toHaveProperty("sessionToken");
});
export const AccountBlankSecretRetention = story(() => <AccountReview editing />, {}, async (fixture) => {
  const scope = await dialog("Edit Connection");
  expect(scope.getByLabelText("API Key")).toHaveValue("");
  await replace(scope.getByLabelText("Name"), "Renamed review account");
  await userEvent.click(scope.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(fixture.snapshot().writes.at(-1)?.payload.name).toBe("Renamed review account"));
  expect(fixture.snapshot().writes.at(-1).payload).not.toHaveProperty("apiKey");
  expect(fixture.snapshot().connections[0].apiKey).toBe("SYNTHETIC_REVIEW_SECRET");
});
const identityConnections = [{ ...ROUTING_CONNECTION, provider: "cloudflare-ai", providerSpecificData: { accountId: "review-tenant-a" } }, { ...ROUTING_CONNECTION, id: "review-account-b", provider: "cloudflare-ai", name: "Second review account", providerSpecificData: {} }];
export const AccountTenantSwitch = story(() => <AccountReview editing connections={identityConnections} />, { connections: identityConnections }, async () => {
  const scope = await dialog("Edit Connection");
  expect(scope.getByLabelText("Account ID")).toHaveValue("review-tenant-a");
  await userEvent.click(scope.getByRole("button", { name: "Cancel" }));
  await userEvent.click(bodyScope().getByRole("button", { name: "Switch review account" }));
  await userEvent.click(bodyScope().getByRole("button", { name: "Edit review account" }));
  const nextScope = await dialog("Edit Connection");
  await waitFor(() => expect(nextScope.getByLabelText("Name")).toHaveValue("Second review account"));
  expect(nextScope.getByLabelText("Account ID")).toHaveValue("");
});
const awsConnection = { ...ROUTING_CONNECTION, provider: "bedrock", providerSpecificData: { accessKeyId: "ASIA_REVIEW_ONLY", region: "us-east-1", retainedField: "keep" } };
export const AwsEditRetainsSession = story(() => <AccountReview editing connections={[awsConnection]} />, { connections: [awsConnection] }, async (fixture) => {
  const scope = await dialog("Edit Connection");
  expect(scope.getByLabelText("Session Token (temporary ASIA... keys only)", { exact: false })).toHaveValue("");
  await userEvent.click(scope.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(fixture.snapshot().writes).toHaveLength(1));
  expect(fixture.snapshot().writes[0].payload).not.toHaveProperty("sessionToken");
  expect(fixture.snapshot().connections[0].sessionToken).toBe("SYNTHETIC_SESSION_SECRET");
});
export const VisibleModelsRetainsUnavailable = story(() => <VisibilityReview />, {}, async (fixture) => {
  const scope = await dialog("Visible models");
  await expect(await scope.findByText("not in catalog")).toBeVisible();
  await expect(scope.getByText("Always exposed (custom models)")).toBeVisible();
  await userEvent.click(scope.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(fixture.snapshot().enabledModels).toEqual(["review-missing-model"]));
});
export const VisibleModelsUnrestricted = story(() => <VisibilityReview />, {}, async (fixture) => {
  const scope = await dialog("Visible models");
  await scope.findByText("not in catalog");
  await userEvent.click(scope.getByRole("button", { name: "Clear" }));
  await userEvent.click(scope.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(fixture.snapshot().enabledModels).toEqual([]));
});
export const VisibleModelsLoadFailure = story(() => <VisibilityReview />, { failures: { "GET /api/models/enabled": "Review allowlist unavailable" } }, async () => {
  const scope = await dialog("Visible models");
  await scope.findByText(/Could not load the current allowlist/);
  expect(scope.getByRole("button", { name: "Save" })).toBeDisabled();
});
export const ProviderLiteralErrorRules = story(() => <RulesReview />, {}, async (fixture) => {
  const scope = await dialog("Provider Error Rules");
  await userEvent.type(scope.getByLabelText("Match (substring, case-insensitive)"), "daily cap hit");
  await userEvent.type(scope.getByLabelText("Cooldown seconds (optional)"), "20");
  await choose(scope, "Rule scope", "Connection");
  await userEvent.click(scope.getByRole("button", { name: "Add Rule" }));
  await userEvent.click(scope.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(fixture.snapshot().settings.providerErrorRules.openai).toEqual([{ status: 429, match: "daily cap hit", scope: "connection", cooldownMs: 20000 }]));
});
export const ProviderErrorRulesFailure = story(() => <RulesReview />, { failures: { "PATCH /api/settings": "Review rules save failed" } }, async () => {
  const scope = await dialog("Provider Error Rules");
  await userEvent.click(scope.getByRole("button", { name: "Save" }));
  await expect(await scope.findByRole("alert")).toHaveTextContent("Review rules save failed");
});
export const ModelSyncEnabled = story(() => <SyncReview />);
export const ModelSyncRetainsPreviousOnFailure = story(() => <SyncReview />, { syncError: "Review upstream unavailable" }, async () => {
  await userEvent.click(await bodyScope().findByRole("button", { name: "Sync now" }));
  await expect(await bodyScope().findByRole("status")).toHaveTextContent("The previous model list is kept");
  expect(bodyScope().getByText("1 effective models")).toBeVisible();
});
export const ModelSyncTogglePersists = story(() => <SyncReview />, {}, async (fixture) => {
  await userEvent.click(await bodyScope().findByRole("switch", { name: "Auto-update models" }));
  await waitFor(() => expect(fixture.snapshot().settings.modelAutoSyncProviders.openai).toBe(false));
});

const keysPage = () => <KeysPageClient />;
export const KeyPolicyInventory = story(keysPage, { pathname: "/dashboard/keys" });
export const KeyDisabledEditRoundtrip = story(keysPage, { pathname: "/dashboard/keys" }, async (fixture) => {
  await userEvent.click(await bodyScope().findByRole("button", { name: "Edit Restricted review client" }));
  const scope = await dialog(/Edit API Key/);
  await userEvent.click(scope.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(fixture.snapshot().writes).toHaveLength(1));
  const key = fixture.snapshot().keys[0];
  expect(key.isActive).toBe(false);
  expect(key.expiresAt).toBe(ROUTING_KEY.expiresAt);
  expect(key.policy.allowedModels).toEqual(ROUTING_KEY.policy.allowedModels);
  expect(key.providerConnectionIds).toEqual(["review-account"]);
  expect(key.groupIds).toEqual(["review-label"]);
});
export const KeyLimitsRoundtrip = story(keysPage, { pathname: "/dashboard/keys" }, async (fixture) => {
  await userEvent.click(await bodyScope().findByRole("button", { name: "Limits for Restricted review client" }));
  const scope = await dialog(/Limits/);
  await replace(scope.getByLabelText("Requests / minute"), "20");
  await replace(scope.getByLabelText("Budget (USD)"), "9");
  await userEvent.click(scope.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(fixture.snapshot().keys[0].policy.rpmLimit).toBe(20));
  expect(fixture.snapshot().keys[0].policy.monthlyBudget).toBe(9);
  expect(fixture.snapshot().keys[0].policy.allowedModels).toEqual(["openai/gpt-4o"]);
});
export const KeyEditSaveFailure = story(keysPage, { pathname: "/dashboard/keys", failures: { "PUT /api/keys/review-key": "Review policy save failed" } }, async () => {
  await userEvent.click(await bodyScope().findByRole("button", { name: "Edit Restricted review client" }));
  const scope = await dialog(/Edit API Key/);
  await userEvent.click(scope.getByRole("button", { name: "Save" }));
  await expect(await scope.findByText("Review policy save failed")).toBeVisible();
});
export const KeyCreatePolicyForm = story(keysPage, { pathname: "/dashboard/keys", keys: [] }, async () => {
  await userEvent.click(await bodyScope().findByRole("button", { name: "Create Key" }));
  const scope = await dialog("Create API Key");
  expect(scope.getByLabelText("Lifetime token limit")).toBeVisible();
  expect(scope.getByLabelText("Lifetime cost limit (USD)")).toBeVisible();
});
export const KeyModelAllowPattern = story(keysPage, { pathname: "/dashboard/keys" }, async (fixture) => {
  await userEvent.click(await bodyScope().findByRole("button", { name: "Model access for Restricted review client" }));
  const scope = await dialog(/Model access/i);
  await userEvent.click(scope.getByText("Allow only"));
  await userEvent.type(scope.getByLabelText("Add a rule"), "openai/*");
  await userEvent.click(scope.getByRole("button", { name: "Add" }));
  await userEvent.click(scope.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(fixture.snapshot().keys[0].policy.modelAccess).toEqual({ mode: "allow", patterns: ["openai/*"] }));
  expect(fixture.snapshot().keys[0].policy.rpmLimit).toBe(15);
});
export const KeyGroupRename = story(keysPage, { pathname: "/dashboard/keys" }, async (fixture) => {
  await userEvent.click(await bodyScope().findByRole("button", { name: "Rename Review clients" }));
  const scope = await dialog("Rename group");
  await replace(scope.getByLabelText("Group name"), "Renamed clients");
  await userEvent.click(scope.getByRole("button", { name: "Rename" }));
  await waitFor(() => expect(fixture.snapshot().keyGroups[0].name).toBe("Renamed clients"));
  expect(fixture.snapshot().keys[0].providerConnectionIds).toEqual(["review-account"]);
});
export const EndpointRequiresKey = story(() => <EndpointPageClient localPort={20128} />, { pathname: "/dashboard/endpoint" });
export const EndpointKeyProtectionPersists = story(() => <EndpointPageClient localPort={20128} />, { pathname: "/dashboard/endpoint", settings: { requireApiKey: false } }, async (fixture) => {
  const toggle = await bodyScope().findByRole("switch", { name: "Require API key" });
  await userEvent.click(toggle);
  await waitFor(() => expect(fixture.snapshot().settings.requireApiKey).toBe(true));
});
export const EndpointTunnelProtection = story(() => <EndpointPageClient localPort={20128} />, { pathname: "/dashboard/endpoint", tunnel: { enabled: true, tunnelUrl: "https://tunnel.example.test", publicUrl: "https://tunnel.example.test", allUrls: [] } });
export const EndpointTailscaleProtection = story(() => <EndpointPageClient localPort={20128} />, { pathname: "/dashboard/endpoint", tailscale: { enabled: true, tunnelUrl: "https://tailnet.example.test" } });
const comboPage = () => <CombosPage />;
export const ComboFallback = story(comboPage, { pathname: "/dashboard/combos", strategy: "fallback" });
export const ComboRoundRobin = story(comboPage, { pathname: "/dashboard/combos", strategy: "round-robin" });
export const ComboWeighted = story(comboPage, { pathname: "/dashboard/combos", strategy: "weighted" });
export const ComboSmartScoring = story(comboPage, { pathname: "/dashboard/combos", strategy: "smart-scoring" });
export const ComboSmart = story(comboPage, { pathname: "/dashboard/combos", strategy: "smart" });
export const ComboFusionJudge = story(comboPage, { pathname: "/dashboard/combos", strategy: "fusion" });
export const ComboStrategyPersists = story(comboPage, { pathname: "/dashboard/combos" }, async (fixture) => {
  const scope = bodyScope();
  await scope.findByLabelText("Strategy for review-route");
  await choose(scope, "Strategy for review-route", /Weighted/);
  await waitFor(() => expect(fixture.snapshot().settings.comboStrategies["review-route"].fallbackStrategy).toBe("weighted"));
});
export const ComboMemberWeightsAndCapabilities = story(comboPage, { pathname: "/dashboard/combos", strategy: "weighted" }, async () => {
  const scope = bodyScope();
  const card = (await scope.findByText("review-route")).closest(".group");
  await userEvent.click(within(card).getByRole("button", { name: "Edit" }));
  const form = await dialog("Edit Combo");
  expect(form.getAllByLabelText("Weight")).toHaveLength(2);
  expect(form.getByLabelText("Context window")).toHaveValue(32000);
});
export const ConnectionGroupsMembership = story(() => <ConnectionGroupsPanel connections={VISIBLE_CONNECTIONS} onGroupsChange={() => {}} />, { pathname: "/dashboard/combos" });
export const ConnectionGroupsRemoveMember = story(() => <ConnectionGroupsPanel connections={VISIBLE_CONNECTIONS} onGroupsChange={() => {}} />, { pathname: "/dashboard/combos" }, async (fixture) => {
  const scope = bodyScope();
  const remove = await scope.findByRole("button", { name: /Remove Review account/ });
  await userEvent.click(remove);
  await waitFor(() => expect(fixture.snapshot().groups[0].connectionIds).toEqual([]));
  expect(fixture.snapshot().connections).toHaveLength(1);
});
export const MediaAutomaticEndpointRoutes = story(() => <MediaRoutesPage />, { pathname: "/dashboard/media-routes" });
export const MediaCustomUnavailableModels = story(() => <MediaRoutesPage />, { pathname: "/dashboard/media-routes", mediaCustom: true });
export const MediaResetToAutomatic = story(() => <MediaRoutesPage />, { pathname: "/dashboard/media-routes", mediaCustom: true }, async (fixture) => {
  const scope = bodyScope();
  const heading = await scope.findByText("Embeddings");
  const card = heading.closest("article") || heading.closest("section") || heading.closest(".rounded-dd-lg");
  await userEvent.click(within(card).getByRole("button", { name: "Use automatic order" }));
  await waitFor(() => expect(fixture.snapshot().mediaRoutes.find((route) => route.id === "embedding").saved).toEqual([]));
});
export const StrictProxyBoundInventory = story(() => <ProxyPoolsPage />, { pathname: "/dashboard/proxy-pools" });
export const StrictProxyEditRoundtrip = story(() => <ProxyPoolsPage />, { pathname: "/dashboard/proxy-pools" }, async (fixture) => {
  await userEvent.click(await bodyScope().findByRole("button", { name: "Edit Strict office proxy" }));
  const scope = await dialog("Edit proxy pool");
  expect(scope.getByLabelText("No proxy")).toHaveValue("localhost,.internal.test");
  expect(scope.getByRole("switch", { name: "Strict proxy" })).toBeChecked();
  await replace(scope.getByLabelText("Name"), "Renamed strict proxy");
  await userEvent.click(scope.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(fixture.snapshot().pools[0].name).toBe("Renamed strict proxy"));
  expect(fixture.snapshot().pools[0]).toMatchObject({ noProxy: "localhost,.internal.test", strictProxy: true, boundConnectionCount: 1 });
});
export const ProxyBatchImportFormats = story(() => <ProxyPoolsPage />, { pathname: "/dashboard/proxy-pools" }, async (fixture) => {
  await userEvent.click(await bodyScope().findByRole("button", { name: "Batch import" }));
  const scope = await dialog("Batch import proxies");
  await userEvent.type(scope.getByLabelText("Paste proxy list, one per line"), "proxy-a.example.test:8080\nproxy-b.example.test:8081:review-user:review-pass");
  await userEvent.click(scope.getByRole("button", { name: "Import" }));
  await waitFor(() => expect(fixture.snapshot().pools).toHaveLength(3));
  expect(fixture.snapshot().pools[2].proxyUrl).toContain("review-user:review-pass@");
});
export const VercelRelaySetup = story(() => <ProxyPoolsPage />, { pathname: "/dashboard/proxy-pools" }, async () => {
  await userEvent.click(await bodyScope().findByRole("button", { name: "Deploy relay" }));
  await userEvent.click(bodyScope().getByRole("button", { name: "Vercel relay" }));
  const scope = await dialog("Deploy Vercel relay");
  expect(scope.getByLabelText("Vercel API token")).toBeVisible();
  expect(scope.getByRole("button", { name: "Deploy" })).toBeDisabled();
});
export const CloudflareRelaySetup = story(() => <ProxyPoolsPage />, { pathname: "/dashboard/proxy-pools" }, async () => {
  await userEvent.click(await bodyScope().findByRole("button", { name: "Deploy relay" }));
  await userEvent.click(bodyScope().getByRole("button", { name: "Cloudflare relay" }));
  const scope = await dialog("Deploy Cloudflare relay");
  expect(scope.getByLabelText("Account ID")).toBeVisible();
  expect(scope.getByLabelText("API token")).toBeVisible();
});
