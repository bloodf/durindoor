// Port of decolua/9router#5786 (source commit
// efbe45057816b197220135bcaf71cd1dc52c9523, fixes upstream #5763):
// publish and resolve the configured custom-provider prefix consistently. The
// prefix is the published/display label; the Playground addresses requests by
// the stable node id.
//
// A custom provider (openai-/anthropic-compatible, custom embedding, System
// One) is a provider node whose id is a UUID-bearing string such as
// `openai-compatible-chat-330c58ab-a28a-46ed-9baa-0e1c8510562c`. The operator
// configures a short prefix ("mirai") on the node and every published model id
// has to use it: an id carrying the node id cannot be pasted into a client.
//
// This file is scoped and offline. It never reaches a provider: routing runs
// against a temporary DATA_DIR, the request log line is produced by a stubbed
// executor, and the dashboard surfaces are pure functions.
//
// Contract preserved here:
//   * the legacy node-id label still routes to the same node,
//   * a node without a configured prefix keeps its node id as the label,
//   * a built-in provider keeps its own id (a stray `prefix` never remaps it),
//   * the prefix is display-only: it never picks the upstream account.

import "../translator/registerAll.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FORMATS } from "../../open-sse/translator/formats.js";

const NODE_ID = "openai-compatible-chat-330c58ab-a28a-46ed-9baa-0e1c8510562c";
const OTHER_NODE_ID = "openai-compatible-chat-11111111-2222-3333-4444-555555555555";
const ANTHROPIC_NODE_ID = "anthropic-compatible-11111111-aaaa-bbbb-cccc-555555555555";
const PREFIX = "mirai";
const MODEL = "deepseek-v4-flash";

// ── chatCore stubs (no upstream is ever contacted) ──────────────────────────

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  handleNonStreamingResponse: vi.fn(),
  createRequestLogger: vi.fn(async () => ({
    logClientRawRequest: vi.fn(), logRawRequest: vi.fn(), logTargetRequest: vi.fn(),
    logProviderResponse: vi.fn(), logConvertedResponse: vi.fn(), logError: vi.fn(),
  })),
}));

vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: vi.fn(() => ({ noAuth: false, execute: mocks.execute })),
}));
vi.mock("../../open-sse/utils/requestLogger.js", () => ({
  createRequestLogger: mocks.createRequestLogger,
}));
vi.mock("open-sse/providers/shared.js", async (importOriginal) => ({
  ...(await importOriginal()),
  ANTIGRAVITY_OAUTH_CLIENT: {},
  GOOGLE_OAUTH_CLIENT: {},
  CLAUDE_CLI_SPOOF_HEADERS: {},
}));
vi.mock("open-sse/providers/index.js", async (importOriginal) => ({
  ...(await importOriginal()),
  PROVIDER_OAUTH: {},
}));
vi.mock("../../open-sse/utils/bypassHandler.js", () => ({ handleBypassRequest: vi.fn(() => null) }));
vi.mock("../../open-sse/utils/clientDetector.js", () => ({
  detectClientTool: vi.fn(() => null), isNativePassthrough: vi.fn(() => false),
  isCodexOriginatedHeaders: vi.fn(() => false),
}));
vi.mock("../../open-sse/utils/streamHandler.js", () => ({
  createStreamController: vi.fn(() => ({
    signal: undefined, startTime: Date.now(), isConnected: () => true,
    handleComplete: vi.fn(), handleError: vi.fn(), handleDisconnect: vi.fn(), abort: vi.fn(),
  })),
}));
vi.mock("../../open-sse/handlers/chatCore/streamingHandler.js", () => ({
  buildOnStreamComplete: vi.fn(() => vi.fn()), handleStreamingResponse: vi.fn(),
}));
vi.mock("../../open-sse/handlers/chatCore/nonStreamingHandler.js", () => ({
  handleNonStreamingResponse: mocks.handleNonStreamingResponse,
}));
vi.mock("../../open-sse/handlers/chatCore/proxyTimeline.js", () => ({
  startTrace: vi.fn(() => "trace-prefix"),
  record: vi.fn(),
  finishTrace: vi.fn(),
  attachClientFrameTap: vi.fn(),
}));
vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  finishActiveSession: vi.fn(),
  appendRequestLog: vi.fn(() => Promise.resolve()),
  saveRequestDetail: vi.fn(),
}));

const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");
const { resolveProviderPrefix, isCustomProviderId } = await import("@/shared/utils/providerPrefix.js");
const { normalizeLiveModel, normalizeStaticModel, groupModelsByProvider } =
  await import("@/app/(dashboard)/dashboard/playground/playgroundHelpers.js");
const { buildModelIndex, resolveSavedModel } =
  await import("@/app/(dashboard)/dashboard/playground/playgroundHelpers.js");
const { buildDashboardCapsIndex } = await import("@/shared/hooks/useModelCaps.js");

// ── shared helpers ──────────────────────────────────────────────────────────

function node(overrides = {}) {
  return {
    id: NODE_ID,
    type: "openai-compatible",
    name: "MiraiAPI",
    prefix: PREFIX,
    apiType: "chat",
    baseUrl: "https://compatible.test/v1",
    ...overrides,
  };
}

function connection(overrides = {}) {
  return {
    id: "conn-1",
    provider: NODE_ID,
    name: "MiraiAPI",
    isActive: true,
    providerSpecificData: { prefix: PREFIX, apiType: "chat", baseUrl: "https://compatible.test/v1" },
    ...overrides,
  };
}

// ── 1. the shared resolver ──────────────────────────────────────────────────

describe("resolveProviderPrefix", () => {
  it("prefers the prefix stored on the connection", () => {
    expect(resolveProviderPrefix({
      providerId: NODE_ID,
      providerSpecificData: connection().providerSpecificData,
      node: node(),
    })).toBe(PREFIX);
  });

  it("falls back to the provider node's prefix", () => {
    expect(resolveProviderPrefix({ providerId: NODE_ID, node: node() })).toBe(PREFIX);
  });

  it("keeps the node id as the stable legacy label when no prefix is configured", () => {
    expect(resolveProviderPrefix({ providerId: NODE_ID, node: node({ prefix: "" }) })).toBe(NODE_ID);
    expect(resolveProviderPrefix({ providerId: NODE_ID })).toBe(NODE_ID);
  });

  it("ignores a blank prefix", () => {
    expect(resolveProviderPrefix({
      providerId: NODE_ID,
      providerSpecificData: { prefix: "   " },
      node: node(),
    })).toBe(PREFIX);
  });

  it("never remaps a built-in provider", () => {
    expect(resolveProviderPrefix({
      providerId: "openai",
      providerSpecificData: { prefix: "not-the-alias" },
    })).toBe("openai");
    expect(resolveProviderPrefix({ providerId: "codex" })).toBe("codex");
  });

  it("recognizes the custom provider families", () => {
    expect(isCustomProviderId(NODE_ID)).toBe(true);
    expect(isCustomProviderId("anthropic-compatible-abc")).toBe(true);
    expect(isCustomProviderId("custom-embedding-abc")).toBe(true);
    expect(isCustomProviderId("systemone-compatible-abc")).toBe(true);
    // A node installed before the prefix scheme carries a bare UUID as id.
    expect(isCustomProviderId("330c58ab-a28a-46ed-9baa-0e1c8510562c")).toBe(true);
    expect(isCustomProviderId("openai")).toBe(false);
    expect(isCustomProviderId(undefined)).toBe(false);
  });

  it("publishes the prefix of a node whose id is a bare UUID", () => {
    const legacyId = "330c58ab-a28a-46ed-9baa-0e1c8510562c";
    expect(resolveProviderPrefix({
      providerId: legacyId,
      providerSpecificData: { prefix: PREFIX },
    })).toBe(PREFIX);
  });
});

// ── 2. the dashboard Playground publishes the prefix ────────────────────────

describe("Playground model ids", () => {
  it("addresses a live compatible model by the node id and displays the prefix", () => {
    const row = normalizeLiveModel({ id: MODEL, name: "DeepSeek" }, connection());
    // Canonical internal request id: stable, bound to the selected node.
    expect(row.requestModel).toBe(`${NODE_ID}/${MODEL}`);
    expect(row.id).toBe(`${NODE_ID}/${MODEL}`);
    // The configured prefix is shown separately and is never the request id.
    expect(row.prefix).toBe(PREFIX);
    expect(row.displayModel).toBe(`${PREFIX}/${MODEL}`);
    expect(row.requestModel).not.toBe(row.displayModel);
    expect(row.providerId).toBe(NODE_ID);
    expect(row.providerName).toBe("MiraiAPI");
  });

  it("addresses a static compatible model by the node id and displays the prefix", () => {
    const row = normalizeStaticModel({ id: MODEL, name: "DeepSeek" }, connection());
    expect(row.requestModel).toBe(`${NODE_ID}/${MODEL}`);
    expect(row.id).toBe(row.requestModel);
    expect(row.prefix).toBe(PREFIX);
    expect(row.displayModel).toBe(`${PREFIX}/${MODEL}`);
  });

  it("shows the node id as the label when no prefix is configured", () => {
    const bare = connection({ providerSpecificData: { apiType: "chat" } });
    const row = normalizeLiveModel({ id: MODEL }, bare);
    expect(row.requestModel).toBe(`${NODE_ID}/${MODEL}`);
    expect(row.displayModel).toBe(`${NODE_ID}/${MODEL}`);
  });

  it("keeps the request id on the selected node when two nodes share a prefix", () => {
    const other = connection({ provider: OTHER_NODE_ID });
    const a = normalizeLiveModel({ id: MODEL }, connection());
    const b = normalizeLiveModel({ id: MODEL }, other);
    expect(a.displayModel).toBe(b.displayModel);
    expect(a.requestModel).toBe(`${NODE_ID}/${MODEL}`);
    expect(b.requestModel).toBe(`${OTHER_NODE_ID}/${MODEL}`);
  });

  it("keeps a live id that already carries a provider segment verbatim", () => {
    // Scoped to a built-in provider, where the id is already a gateway address.
    const builtIn = { id: "conn-gateway", provider: "openrouter", name: "Gateway", isActive: true, providerSpecificData: {} };
    const row = normalizeLiveModel({ id: "vendor/some-model" }, builtIn);
    expect(row.requestModel).toBe("vendor/some-model");
  });

  it("binds a namespaced live id on a compatible node to the node id and keeps the namespace", () => {
    // Offline adapter fixture: ordinary namespaced upstream ids as a compatible
    // node's model list returns them.
    const ids = ["vendor/some-model", "team/sub/model-1", "acme/model:latest"];
    for (const id of ids) {
      const row = normalizeLiveModel({ id }, connection());
      expect(row.requestModel).toBe(`${NODE_ID}/${id}`);
      expect(row.id).toBe(row.requestModel);
      expect(row.requestModel.startsWith(`${NODE_ID}/`)).toBe(true);
      expect(row.requestModel.slice(NODE_ID.length + 1)).toBe(id);
      expect(row.providerId).toBe(NODE_ID);
    }
    const anthropic = normalizeLiveModel(
      { id: "vendor/some-model" },
      { id: "conn-a", provider: ANTHROPIC_NODE_ID, name: "Claude Gateway", providerSpecificData: { prefix: "cg" } }
    );
    expect(anthropic.requestModel).toBe(`${ANTHROPIC_NODE_ID}/vendor/some-model`);
  });

  it("shows a namespaced live id under the prefix as a label, separate from the request id", () => {
    const row = normalizeLiveModel({ id: "vendor/some-model", name: "Some Model" }, connection());
    expect(row.prefix).toBe(PREFIX);
    expect(row.displayModel).toBe(`${PREFIX}/vendor/some-model`);
    expect(row.displayModel).not.toBe(row.requestModel);
    expect(row.name).toBe("Some Model");
  });

  it("keeps same-named namespaced models on two nodes under distinct request ids", () => {
    const a = normalizeLiveModel({ id: "vendor/some-model" }, connection());
    const b = normalizeLiveModel({ id: "vendor/some-model" }, connection({ provider: OTHER_NODE_ID }));
    expect(a.requestModel).toBe(`${NODE_ID}/vendor/some-model`);
    expect(b.requestModel).toBe(`${OTHER_NODE_ID}/vendor/some-model`);
    expect(a.requestModel).not.toBe(b.requestModel);
  });

  it("leaves a built-in provider on its own id", () => {
    const codex = { id: "conn-codex", provider: "codex", name: "Codex", isActive: true, providerSpecificData: {} };
    expect(normalizeLiveModel({ id: "gpt-5.4" }, codex).requestModel).toBe("gpt-5.4");
    const stat = normalizeStaticModel({ id: "gpt-5.4" }, codex);
    expect(stat.requestModel).toBe("codex/gpt-5.4");
    expect(stat.displayModel).toBe("codex/gpt-5.4");
    // A stray prefix on a built-in connection never renames it.
    const stray = { ...codex, providerSpecificData: { prefix: "not-the-alias" } };
    expect(normalizeStaticModel({ id: "gpt-5.4" }, stray).displayModel).toBe("codex/gpt-5.4");
  });

  it("resolves a legacy saved alias through provider identity and never guesses an ambiguous one", () => {
    const rowA = normalizeLiveModel({ id: "vendor/some-model" }, connection());
    const rowB = normalizeLiveModel({ id: "vendor/some-model" }, connection({ provider: OTHER_NODE_ID }));
    const solo = normalizeLiveModel({ id: "solo/model" }, connection());
    const index = buildModelIndex([
      { providerId: NODE_ID, providerName: "MiraiAPI", models: [rowA, solo] },
      { providerId: OTHER_NODE_ID, providerName: "MiraiAPI", models: [rowB] }
    ]);
    // A canonical id resolves to its own row, and only for the provider that saved it.
    expect(resolveSavedModel(index, rowA.id, NODE_ID).providerId).toBe(NODE_ID);
    expect(resolveSavedModel(index, rowA.id, OTHER_NODE_ID)).toBeNull();
    expect(resolveSavedModel(index, rowA.id).providerId).toBe(NODE_ID);
    // A raw namespaced id saved before node binding resolves by provider identity.
    expect(resolveSavedModel(index, "vendor/some-model", NODE_ID).requestModel).toBe(rowA.requestModel);
    expect(resolveSavedModel(index, "vendor/some-model", OTHER_NODE_ID).requestModel).toBe(rowB.requestModel);
    // An alias shared by two nodes with no provider identity is not resolved.
    expect(resolveSavedModel(index, "vendor/some-model")).toBeNull();
    expect(resolveSavedModel(index, `${PREFIX}/vendor/some-model`)).toBeNull();
    // A provider that does not own the alias does not resolve it.
    expect(resolveSavedModel(index, "vendor/some-model", "unknown-node")).toBeNull();
    // An alias held by exactly one row resolves.
    expect(resolveSavedModel(index, "solo/model").requestModel).toBe(solo.requestModel);
    expect(resolveSavedModel(index, "")).toBeNull();
  });

  describe("saved selections stay bound to their provider", () => {
    const builtIn = { id: "conn-gw", provider: "openrouter", name: "Gateway", isActive: true, providerSpecificData: {} };
    const second = { id: "conn-gw-2", provider: "togetherai", name: "Together", isActive: true, providerSpecificData: {} };

    function indexFor(...groups) {
      return buildModelIndex(groups.map(({ connection: c, models }) => ({
        providerId: c.provider,
        providerName: c.name,
        models
      })));
    }

    it("never resolves a canonical id to another provider's row", () => {
      const own = normalizeLiveModel({ id: "shared-model" }, builtIn);
      const other = normalizeLiveModel({ id: "shared-model" }, second);
      const index = indexFor({ connection: builtIn, models: [own] }, { connection: second, models: [other] });
      expect(resolveSavedModel(index, "shared-model", "openrouter").providerId).toBe("openrouter");
      expect(resolveSavedModel(index, "shared-model", "togetherai").providerId).toBe("togetherai");
      // No provider identity and two owners: not resolved.
      expect(resolveSavedModel(index, "shared-model")).toBeNull();
      // A provider that lists no such model: not resolved.
      expect(resolveSavedModel(index, "shared-model", "unknown-node")).toBeNull();
    });

    it("keeps a legacy raw id on its node when the text is another provider's canonical id", () => {
      const gateway = normalizeLiveModel({ id: "vendor/some-model" }, builtIn);
      const compatible = normalizeLiveModel({ id: "vendor/some-model" }, connection());
      expect(gateway.id).toBe("vendor/some-model");
      expect(compatible.aliases).toContain("vendor/some-model");
      const index = indexFor({ connection: builtIn, models: [gateway] }, { connection: connection(), models: [compatible] });
      // Saved before node binding, with the node as provider: stays on the node.
      expect(resolveSavedModel(index, "vendor/some-model", NODE_ID).providerId).toBe(NODE_ID);
      expect(resolveSavedModel(index, "vendor/some-model", NODE_ID).requestModel).toBe(compatible.requestModel);
      // The gateway's own saved selection stays on the gateway.
      expect(resolveSavedModel(index, "vendor/some-model", "openrouter").providerId).toBe("openrouter");
      // The node's canonical id and prefix label resolve for the node only.
      expect(resolveSavedModel(index, compatible.id, NODE_ID).providerId).toBe(NODE_ID);
      expect(resolveSavedModel(index, compatible.id, "openrouter")).toBeNull();
      expect(resolveSavedModel(index, `${PREFIX}/vendor/some-model`, NODE_ID).providerId).toBe(NODE_ID);
      expect(resolveSavedModel(index, `${PREFIX}/vendor/some-model`, "openrouter")).toBeNull();
    });

    it("leaves a missing, removed or ambiguous saved selection unresolved", () => {
      const row = normalizeLiveModel({ id: "vendor/some-model" }, connection());
      const twin = normalizeLiveModel({ id: "vendor/some-model" }, connection({ provider: OTHER_NODE_ID }));
      const index = indexFor(
        { connection: connection(), models: [row] },
        { connection: connection({ provider: OTHER_NODE_ID }), models: [twin] }
      );
      expect(resolveSavedModel(index, "", NODE_ID)).toBeNull();
      expect(resolveSavedModel(index, undefined, NODE_ID)).toBeNull();
      expect(resolveSavedModel(index, "removed/model", NODE_ID)).toBeNull();
      expect(resolveSavedModel(index, "removed/model")).toBeNull();
      expect(resolveSavedModel(index, "vendor/some-model")).toBeNull();
      expect(resolveSavedModel(buildModelIndex([]), row.id, NODE_ID)).toBeNull();
    });

    it("keeps new-session defaults and ordinary compatible-node identities recognised", () => {
      for (const id of [NODE_ID, ANTHROPIC_NODE_ID, "custom-embedding-abc", "systemone-compatible-abc"]) {
        expect(isCustomProviderId(id)).toBe(true);
      }
      const rows = [
        normalizeLiveModel({ id: MODEL }, connection()),
        normalizeLiveModel({ id: MODEL }, { id: "c-a", provider: ANTHROPIC_NODE_ID, name: "Claude Gateway", providerSpecificData: { prefix: "cg" } })
      ];
      expect(rows.map((r) => r.requestModel)).toEqual([`${NODE_ID}/${MODEL}`, `${ANTHROPIC_NODE_ID}/${MODEL}`]);
      const index = buildModelIndex([
        { providerId: NODE_ID, providerName: "MiraiAPI", models: [rows[0]] },
        { providerId: ANTHROPIC_NODE_ID, providerName: "Claude Gateway", models: [rows[1]] }
      ]);
      // A first selection (no saved provider) and an explicit switch resolve their own rows.
      expect(resolveSavedModel(index, rows[0].id).providerId).toBe(NODE_ID);
      expect(resolveSavedModel(index, rows[1].id, ANTHROPIC_NODE_ID).providerId).toBe(ANTHROPIC_NODE_ID);
      expect(resolveSavedModel(index, `${PREFIX}/${MODEL}`, NODE_ID).providerId).toBe(NODE_ID);
    });
  });

  it("keeps the group and ordering contract under the request id", () => {
    const groups = groupModelsByProvider(
      [{ provider: NODE_ID, providerName: "MiraiAPI" }],
      [
        { providerId: NODE_ID, id: `${NODE_ID}/b-model`, name: "Bravo" },
        { providerId: NODE_ID, id: `${NODE_ID}/a-model`, name: "Alpha" }
      ]
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].models.map((m) => m.name)).toEqual(["Alpha", "Bravo"]);
    expect(groups[0].models.map((m) => m.id)).toEqual([`${NODE_ID}/a-model`, `${NODE_ID}/b-model`]);
  });
});

// ── 3. the request log line shows the prefix ────────────────────────────────

describe("request log line", () => {
  const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), line: vi.fn() };

  async function run(provider, providerSpecificData, clientModel) {
    log.line.mockClear();
    const body = { model: clientModel, messages: [{ role: "user", content: "hi" }], stream: false };
    await handleChatCore({
      body: { ...body },
      modelInfo: { provider, model: MODEL },
      credentials: { apiKey: "test-key", providerSpecificData, connectionName: "MiraiAPI" },
      log,
      clientRawRequest: { endpoint: "/v1/chat/completions", body, headers: { accept: "application/json" } },
      sourceFormatOverride: FORMATS.OPENAI,
    });
    const line = log.line.mock.calls.find((call) => call[1] === "▶");
    return line?.[2] || "";
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.execute.mockResolvedValue({
      response: new Response("{}", { status: 200 }),
      url: "https://compatible.test/v1/chat/completions",
      headers: {},
      transformedBody: {},
    });
    mocks.handleNonStreamingResponse.mockResolvedValue({ success: true, response: new Response("{}") });
  });

  it("shows the configured prefix instead of the node id", async () => {
    const line = await run(NODE_ID, { prefix: PREFIX }, `${NODE_ID}/${MODEL}`);
    expect(line).toContain(`→ ${PREFIX}/${MODEL}`);
    expect(line).not.toContain(`→ ${NODE_ID}/${MODEL}`);
  });

  it("matches the id the client sent when the client used the prefix", async () => {
    const line = await run(NODE_ID, { prefix: PREFIX }, `${PREFIX}/${MODEL}`);
    expect(line).toContain(`POST ${PREFIX}/${MODEL} → ${PREFIX}/${MODEL}`);
    expect(line).not.toContain(NODE_ID);
  });

  it("falls back to the node id when no prefix is configured", async () => {
    const line = await run(NODE_ID, {}, `${NODE_ID}/${MODEL}`);
    expect(line).toContain(`→ ${NODE_ID}/${MODEL}`);
  });

  it("leaves a built-in provider on its own id", async () => {
    const line = await run("openai", { prefix: "not-the-alias" }, `openai/${MODEL}`);
    expect(line).toContain(`→ openai/${MODEL}`);
  });
});

// ── 4. the capability lookup resolves the published prefix ──────────────────

describe("dashboard capability lookup", () => {
  const customModels = [{
    id: MODEL,
    providerAlias: NODE_ID,
    type: "llm",
    capabilities: { vision: true, contextWindow: 128000 }
  }];

  it("resolves the published prefix to the stored custom override", () => {
    const { byFull } = buildDashboardCapsIndex({
      customModels,
      providerNodes: [node()],
    });
    expect(byFull[`${PREFIX}/${MODEL}`]).toMatchObject({ vision: true, contextWindow: 128000 });
    // The storage form stays resolvable too.
    expect(byFull[`${NODE_ID}/${MODEL}`]).toMatchObject({ vision: true, contextWindow: 128000 });
  });

  it("derives combo capabilities for a prefix member like the server does", () => {
    const { byCombo } = buildDashboardCapsIndex({
      customModels,
      providerNodes: [node()],
      combos: [{ name: "mirai-combo", models: [`${PREFIX}/${MODEL}`] }],
    });
    expect(byCombo["mirai-combo"]).toMatchObject({ vision: true, contextWindow: 128000 });
  });

  it("leaves a built-in provider's combo members on their own provider", () => {
    const { byCombo } = buildDashboardCapsIndex({
      customModels,
      providerNodes: [node()],
      combos: [{ name: "codex-combo", models: ["codex/gpt-5.4"] }],
    });
    expect(byCombo["codex-combo"]).toBeTruthy();
    // The custom node's override must not leak onto another provider's member.
    expect(byCombo["codex-combo"].contextWindow).not.toBe(128000);
    expect(byCombo["codex-combo"].contextWindow).toBeGreaterThan(0);
  });
});

// ── 5. route selection against a real (temporary) local database ────────────

describe("route selection", () => {
  const originalDataDir = process.env.DATA_DIR;
  let tempDir = "";

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-prefix-5786-"));
    process.env.DATA_DIR = tempDir;
    vi.resetModules();
  });

  afterEach(() => {
    vi.resetModules();
    fs.rmSync(tempDir, { recursive: true, force: true });
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
  });

  async function seed() {
    const { createProviderNode, createProviderConnection, addCustomModel } = await import("@/models/index.js");
    await createProviderNode(node());
    await createProviderConnection({
      provider: NODE_ID,
      name: "MiraiAPI",
      apiKey: "sk-test",
      authType: "api_key",
      isActive: true,
      providerSpecificData: { prefix: PREFIX, apiType: "chat", baseUrl: "https://compatible.test/v1" },
    });
    await addCustomModel({ providerAlias: NODE_ID, id: MODEL, type: "llm" });
  }

  it("routes the published prefix and the legacy node id to the same node", async () => {
    await seed();
    const { getModelInfo } = await import("@/sse/services/model.js");
    const expected = { provider: NODE_ID, model: MODEL };
    await expect(getModelInfo(`${PREFIX}/${MODEL}`)).resolves.toEqual(expected);
    await expect(getModelInfo(`${NODE_ID}/${MODEL}`)).resolves.toEqual(expected);
  });

  it("routes the node id of a node without a configured prefix", async () => {
    const { createProviderNode } = await import("@/models/index.js");
    await createProviderNode(node({ id: OTHER_NODE_ID, prefix: "", name: "NoPrefix" }));
    const { getModelInfo } = await import("@/sse/services/model.js");
    await expect(getModelInfo(`${OTHER_NODE_ID}/${MODEL}`)).resolves.toEqual({
      provider: OTHER_NODE_ID,
      model: MODEL,
    });
  });

  it("keeps a built-in provider alias authoritative over a colliding node prefix", async () => {
    const { createProviderNode } = await import("@/models/index.js");
    await createProviderNode(node({ id: OTHER_NODE_ID, prefix: "cf", name: "Colliding" }));
    const { getModelInfo } = await import("@/sse/services/model.js");
    const resolved = await getModelInfo(`cf/${MODEL}`);
    expect(resolved.provider).not.toBe(OTHER_NODE_ID);
  });
});
