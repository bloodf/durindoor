// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { installStoryNetwork } from "../../.storybook/network.js";
import { createRoutingFixture, ROUTING_CONNECTION, ROUTING_KEY, ROUTING_STRATEGIES } from "../../src/shared/ui/v5/preservation/routing-fixtures.js";
import EditConnectionModal from "../../src/shared/components/EditConnectionModal.js";
import AddApiKeyModal from "../../src/app/(dashboard)/dashboard/providers/[id]/AddApiKeyModal.js";
import KeysPageClient from "../../src/app/(dashboard)/dashboard/keys/KeysPageClient.jsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let cleanup;
let root;
let container;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = null;
  container?.remove();
  container = null;
  if (cleanup) await cleanup();
  cleanup = null;
  document.body.innerHTML = "";
});
function install(options) {
  const fixture = createRoutingFixture(options);
  cleanup = installStoryNetwork({ routes: fixture.routes });
  return fixture;
}
async function json(path, method = "GET", payload) {
  const response = await fetch(path, { method, ...(payload === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }) });
  return { status: response.status, body: await response.json() };
}
async function mount(element) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(element));
}
function input(labelText) {
  const label = [...document.querySelectorAll("label")].find((node) => node.textContent.trim().startsWith(labelText));
  expect(label, `Missing production field ${labelText}`).toBeTruthy();
  return label.htmlFor ? document.getElementById(label.htmlFor) : label.querySelector("input");
}
async function fill(node, value) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(node, value);
    node.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function click(text) {
  const button = [...document.querySelectorAll("button")].find((node) => node.textContent.trim() === text);
  expect(button, `Missing production action ${text}`).toBeTruthy();
  await act(async () => button.click());
}

describe("v5 routing preservation network", () => {
  it("round-trips account identity and omitted secrets without exposing stored secrets through GET", async () => {
    const fixture = install();
    const response = await json("/api/providers/review-account", "PUT", { name: "Renamed", providerSpecificData: { region: "eu-west-1" } });
    expect(response.body.connection.id).toBe("review-account");
    expect(response.body.connection).not.toHaveProperty("apiKey");
    expect((await json("/api/providers")).body.connections[0]).not.toHaveProperty("sessionToken");
    expect(fixture.snapshot().connections[0]).toMatchObject({ apiKey: "SYNTHETIC_REVIEW_SECRET", sessionToken: "SYNTHETIC_SESSION_SECRET", providerSpecificData: { retainedField: "keep", region: "eu-west-1" } });
  });
  it("keeps disabled key, custom expiry and scopes while changing policy limits", async () => {
    const fixture = install();
    const updated = await json("/api/keys/review-key", "PUT", { rpmLimit: 20, monthlyBudget: 9 });
    expect(updated.body.key).toMatchObject({ isActive: false, expiresAt: ROUTING_KEY.expiresAt, groupIds: ["review-label"], allowedCombos: ["review-route"], providerConnectionIds: ["review-account"], policy: { allowedModels: ["openai/gpt-4o"], rpmLimit: 20, monthlyBudget: 9, maxTokens: 60000 } });
    expect((await json("/api/keys")).body.keys[0]).toEqual(fixture.snapshot().keys[0]);
  });
  it.each(ROUTING_STRATEGIES)("retains %s strategy alongside combo weights, timeout and restrictions", async (strategy) => {
    const fixture = install({ strategy });
    await json("/api/settings", "PATCH", { comboStrategies: { "review-route": { fallbackStrategy: strategy, timeoutMs: 9000 } } });
    expect((await json("/api/settings")).body.comboStrategies["review-route"]).toMatchObject({ fallbackStrategy: strategy, timeoutMs: 9000 });
    expect(fixture.snapshot().combos[0]).toMatchObject({ members: [{ id: "openai/gpt-4o", weight: 1 }, { id: "anthropic/claude-sonnet-4.5", weight: 2 }], allowedConnectionIds: ["review-account"] });
  });
  it("saves a media candidate chain and resets to automatic without retaining unavailable effective members", async () => {
    install({ mediaCustom: true });
    const initial = (await json("/api/media-providers/routes")).body.routes.find((route) => route.id === "embedding");
    expect(initial.saved).toEqual(["review/embedding-a", "review/unavailable-model"]);
    expect(initial.effective).toEqual(["review/embedding-a"]);
    const custom = await json("/api/media-providers/routes", "PUT", { kind: "embedding", models: ["review/embedding-b", "review/unavailable-model"] });
    expect(custom.body.route.saved).toEqual(["review/embedding-b", "review/unavailable-model"]);
    expect(custom.body.route.effective).toEqual(["review/embedding-b"]);
    const automatic = await json("/api/media-providers/routes", "PUT", { kind: "embedding", models: [] });
    expect(automatic.body.route.saved).toEqual([]);
    expect(automatic.body.route.effective).toEqual(["review/embedding-a", "review/embedding-b"]);
  });
  it("preserves strict/bypass settings and blocks bound pool deletion", async () => {
    const fixture = install();
    await json("/api/proxy-pools/review-pool", "PUT", { name: "Renamed proxy" });
    const blocked = await json("/api/proxy-pools/review-pool", "DELETE");
    expect(blocked.status).toBe(409);
    expect(fixture.snapshot().pools[0]).toMatchObject({ name: "Renamed proxy", strictProxy: true, noProxy: "localhost,.internal.test", boundConnectionCount: 1 });
    expect(fixture.snapshot().writes.map((write) => write.key)).toEqual(["PUT /api/proxy-pools/review-pool"]);
  });
  it("round-trips group membership without deleting provider accounts", async () => {
    const fixture = install();
    await json("/api/connection-groups/review-group", "PUT", { connectionIds: [] });
    expect((await json("/api/connection-groups")).body.groups[0].connectionIds).toEqual([]);
    await json("/api/connection-groups/review-group", "DELETE");
    expect(fixture.snapshot().connections).toHaveLength(1);
  });
  it("records literal error-rule units and model allowlist empty-unrestricted semantics", async () => {
    install();
    await json("/api/settings", "PATCH", { providerErrorRules: { openai: [{ status: 429, match: "daily cap hit", scope: "connection", cooldownMs: 20000 }] } });
    expect((await json("/api/settings")).body.providerErrorRules.openai[0]).toMatchObject({ match: "daily cap hit", cooldownMs: 20000 });
    await json("/api/models/enabled", "PUT", { providerAlias: "openai", ids: [] });
    expect((await json("/api/models/enabled?providerAlias=openai")).body.ids).toEqual([]);
  });
  it("failed writes retain the prior policy and reset removes writes between story runs", async () => {
    const fixture = install({ failures: { "PUT /api/keys/review-key": "Review save failure" } });
    expect((await json("/api/keys/review-key", "PUT", { expiresAt: null })).status).toBe(503);
    expect(fixture.snapshot().keys[0].expiresAt).toBe(ROUTING_KEY.expiresAt);
    await json("/api/settings", "PATCH", { retryDelayByProvider: { openai: 15 } });
    fixture.reset();
    expect(fixture.snapshot().writes).toEqual([]);
    expect(fixture.snapshot().settings.retryDelayByProvider).toEqual({});
  });
  it("keeps MiMo import and bound Orca flow payloads synthetic and rejects unlisted requests", async () => {
    const fixture = install({ mimoFound: true });
    const detected = await json("/api/oauth/xiaomi-mimo/auto-import");
    expect(detected.body.apiKey).toBe("SYNTHETIC_MIMO");
    await json("/api/oauth/orcarouter/exchange", "POST", { flowId: "review-orca-flow", state: "review-orca-state", code: "SYNTHETIC_CODE" });
    expect(fixture.snapshot().writes[0].payload).toMatchObject({ flowId: "review-orca-flow", state: "review-orca-state" });
    await expect(fetch("/api/unlisted-operation")).rejects.toThrow("Unexpected Storybook network request");
    await expect(fetch("https://provider.example.test/v1/chat/completions")).rejects.toThrow("Unexpected Storybook network request");
  });
});

describe("production account forms in the preservation review", () => {
  it("the production key editor preserves disabled state, expiry and policy when saved unchanged", async () => {
    const fixture = install();
    await mount(React.createElement(KeysPageClient));
    const edit = document.querySelector('button[aria-label="Edit Restricted review client"]');
    expect(edit).toBeTruthy();
    await act(async () => edit.click());
    await click("Save");
    expect(fixture.snapshot().writes[0].key).toBe("PUT /api/keys/review-key");
    const saved = fixture.snapshot().keys[0];
    expect(saved.isActive).toBe(false);
    expect(saved.expiresAt).toBe(ROUTING_KEY.expiresAt);
    expect(saved.policy).toEqual(ROUTING_KEY.policy);
    expect(saved.groupIds).toEqual(ROUTING_KEY.groupIds);
    expect(saved.providerConnectionIds).toEqual(ROUTING_KEY.providerConnectionIds);
  });
  it("switching the real account editor clears the previous tenant identity", async () => {
    install();
    const props = { isOpen: true, onClose() {}, onSave() {} };
    await mount(React.createElement(EditConnectionModal, { ...props, connection: { ...ROUTING_CONNECTION, provider: "cloudflare-ai", providerSpecificData: { accountId: "tenant-review-a" } } }));
    expect(input("Account ID").value).toBe("tenant-review-a");
    await act(async () => root.render(React.createElement(EditConnectionModal, { ...props, connection: { ...ROUTING_CONNECTION, id: "review-b", provider: "cloudflare-ai", providerSpecificData: {} } })));
    expect(input("Account ID").value).toBe("");
  });
  it("EditConnectionModal omits a blank secret and saves the selected account identity", async () => {
    const fixture = install();
    await mount(React.createElement(EditConnectionModal, { isOpen: true, connection: ROUTING_CONNECTION, onClose() {}, onSave: (payload) => json("/api/providers/review-account", "PUT", payload) }));
    expect(input("API Key").value).toBe("");
    await fill(input("Name"), "Renamed production form");
    await click("Save");
    expect(fixture.snapshot().writes[0].payload).toMatchObject({ name: "Renamed production form" });
    expect(fixture.snapshot().writes[0].payload).not.toHaveProperty("apiKey");
    expect(fixture.snapshot().connections[0].apiKey).toBe("SYNTHETIC_REVIEW_SECRET");
  });
  it("AddApiKeyModal can save a keyless local account with the real form", async () => {
    const fixture = install({ connections: [] });
    await mount(React.createElement(AddApiKeyModal, { isOpen: true, provider: "ollama-local", providerName: "ollama-local", authType: "apikey", proxyPools: [], existingConnectionNames: [], onClose() {}, onBulkDone() {}, onSave: (payload) => json("/api/providers", "POST", { provider: "ollama-local", ...payload }) }));
    await fill(input("Ollama Host URL"), "http://ollama.example.test:11434");
    await click("Save");
    const saved = fixture.snapshot().writes.find((write) => write.key === "POST /api/providers");
    expect(saved.payload).toMatchObject({ provider: "ollama-local", apiKey: "", name: "main" });
    expect(saved.payload.providerSpecificData.baseUrl).toMatch(/^http/);
  });
  it("the real AWS profile form submits no static secret", async () => {
    const fixture = install({ connections: [] });
    await mount(React.createElement(AddApiKeyModal, { isOpen: true, provider: "bedrock", providerName: "Amazon Bedrock", authType: "apikey", proxyPools: [], existingConnectionNames: [], onClose() {}, onBulkDone() {}, onSave: (payload) => json("/api/providers", "POST", { provider: "bedrock", ...payload }) }));
    await fill(input("AWS Profile"), "review-sso-profile");
    await click("Save");
    expect(fixture.snapshot().writes[0].payload).toMatchObject({ provider: "bedrock", apiKey: "", providerSpecificData: { profile: "review-sso-profile" } });
  });
  it("the real AWS temporary-key form saves the session token at the request boundary", async () => {
    const fixture = install({ connections: [] });
    await mount(React.createElement(AddApiKeyModal, { isOpen: true, provider: "bedrock", providerName: "Amazon Bedrock", authType: "apikey", proxyPools: [], existingConnectionNames: [], onClose() {}, onBulkDone() {}, onSave: (payload) => json("/api/providers", "POST", { provider: "bedrock", ...payload }) }));
    await fill(input("Access Key ID"), "ASIA_REVIEW_ONLY");
    await fill(input("API Key"), "SYNTHETIC_AWS_SECRET");
    await fill(input("Session Token"), "SYNTHETIC_AWS_SESSION");
    await click("Save");
    const payload = fixture.snapshot().writes[0].payload;
    expect(payload).toMatchObject({ sessionToken: "SYNTHETIC_AWS_SESSION", apiKey: "SYNTHETIC_AWS_SECRET", providerSpecificData: { accessKeyId: "ASIA_REVIEW_ONLY" } });
    expect(payload.providerSpecificData).not.toHaveProperty("sessionToken");
  });
  it("the real AWS editor retains a stored session token when its field is left blank", async () => {
    const connection = { ...ROUTING_CONNECTION, provider: "bedrock", providerSpecificData: { accessKeyId: "ASIA_REVIEW_ONLY", region: "us-east-1" } };
    const fixture = install({ connections: [connection] });
    await mount(React.createElement(EditConnectionModal, { isOpen: true, connection, onClose() {}, onSave: (payload) => json("/api/providers/review-account", "PUT", payload) }));
    expect(input("Session Token").value).toBe("");
    await click("Save");
    expect(fixture.snapshot().writes[0].payload).not.toHaveProperty("sessionToken");
    expect(fixture.snapshot().connections[0].sessionToken).toBe("SYNTHETIC_SESSION_SECRET");
  });
});
