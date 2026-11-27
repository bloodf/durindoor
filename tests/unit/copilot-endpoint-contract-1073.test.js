/**
 * Port test (OmniRoute #15337 + #15499): Copilot's discovered endpoint contract.
 *
 * Upstream #15337 preserved the endpoint metadata Copilot's live catalog
 * advertises and used it to send a Responses-only model straight to
 * /responses instead of letting it fail on /chat/completions. Upstream #15499
 * applied the same contract to GitHub Enterprise Copilot's GPT-6 family.
 *
 * This fork's Copilot executors own the route choice (the registry declares
 * no per-model targetFormat, and the executor — not chatCore — converts the
 * body for /responses), so the contract is applied at the executor seam:
 * the discovered route selects the existing chat or Responses route, the
 * provider's own error still escalates a model with no metadata, Claude keeps
 * its Messages route, and the models Copilot's Responses endpoint does not
 * serve stay excluded.
 *
 * Fixtures are synthetic: a catalog payload and request bodies only. No
 * network, no credentials, no real provider.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  proxyAwareFetch: vi.fn(),
  refreshCopilotToken: vi.fn(),
  updateProviderConnection: vi.fn(),
  updateProviderCredentials: vi.fn(),
}));

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: mocks.proxyAwareFetch,
}));

vi.mock("../../open-sse/services/tokenRefresh.js", () => ({
  refreshCopilotToken: mocks.refreshCopilotToken,
}));

vi.mock("@/lib/localDb", () => ({
  updateProviderConnection: mocks.updateProviderConnection,
}));

vi.mock("@/sse/services/tokenRefresh", () => ({
  refreshGoogleToken: vi.fn(),
  updateProviderCredentials: mocks.updateProviderCredentials,
}));

import {
  buildCopilotEndpointContract,
  readCopilotEndpointContract,
  readCopilotEndpointKinds,
  resolveCopilotEndpointRoute,
} from "../../open-sse/services/copilotEndpointContract.js";
import { clearCopilotModelCache, resolveCopilotModels } from "../../open-sse/services/catalogs/copilotModels.js";
import { GithubExecutor } from "../../open-sse/executors/github.js";
import { GheCopilotExecutor } from "../../open-sse/executors/ghe-copilot.js";
import { persistCopilotEndpointContract } from "../../src/app/api/providers/[id]/models/modelsConfig.js";

const CHAT_BODY = {
  model: "gpt-6-luna",
  messages: [{ role: "user", content: "hi" }],
  max_tokens: 16,
};

const GHE_CREDENTIALS = {
  accessToken: "gho",
  copilotToken: "cp",
  providerSpecificData: {
    gheUrl: "https://acme.ghe.com",
    copilotApiUrl: "https://copilot-api.acme.ghe.com",
  },
};

function credentialsWithContract(contract) {
  return {
    accessToken: "tok",
    providerSpecificData: contract ? { copilotEndpointContract: contract } : {},
  };
}

function sentBody(callIndex = 0) {
  return JSON.parse(mocks.proxyAwareFetch.mock.calls[callIndex][1].body);
}

describe("Copilot endpoint contract normalization", () => {
  it("reads the endpoint kinds a catalog row declares", () => {
    expect(readCopilotEndpointKinds({ supported_endpoints: ["/responses"] })).toEqual(["responses"]);
    expect(readCopilotEndpointKinds({ supported_endpoints: ["/chat/completions"] })).toEqual(["chat"]);
    expect(readCopilotEndpointKinds({ supported_endpoints: ["/v1/messages"] })).toEqual(["chat"]);
    expect(readCopilotEndpointKinds({ capabilities: { supported_endpoints: ["/responses"] } })).toEqual(["responses"]);
  });

  it("normalizes paths, trims them and drops unusable entries", () => {
    expect(readCopilotEndpointKinds({ supported_endpoints: [" /v1/responses/ ", null, 42, ""] })).toEqual(["responses"]);
    expect(readCopilotEndpointKinds({ supported_endpoints: ["/v1/responses", "/responses"] })).toEqual(["responses"]);
  });

  it("lets the top-level list win over the nested one", () => {
    expect(readCopilotEndpointKinds({
      supported_endpoints: ["/chat/completions"],
      capabilities: { supported_endpoints: ["/responses"] },
    })).toEqual(["chat"]);
  });

  it("marks a Responses-only model and leaves chat-capable models unrouted", () => {
    expect(readCopilotEndpointContract({ supported_endpoints: ["/responses"] }, "gpt-6-luna")).toEqual({
      supportedEndpoints: ["responses"],
      targetFormat: "openai-responses",
    });
    expect(readCopilotEndpointContract({ supported_endpoints: ["/chat/completions"] }, "gpt-6-chat")).toEqual({
      supportedEndpoints: ["chat"],
    });
    expect(readCopilotEndpointContract({ supported_endpoints: ["/responses", "/chat/completions"] }, "gpt-6-dual")).toEqual({
      supportedEndpoints: ["chat", "responses"],
    });
  });

  it("never promotes Claude or Gemini models to the Responses route", () => {
    expect(readCopilotEndpointContract({ supported_endpoints: ["/responses"] }, "claude-future")).toEqual({
      supportedEndpoints: ["responses"],
    });
    expect(readCopilotEndpointContract({ supported_endpoints: ["/responses"] }, "gemini-future")).toEqual({
      supportedEndpoints: ["responses"],
    });
  });

  it("keeps no contract for a row that declares no endpoint", () => {
    expect(readCopilotEndpointContract({ id: "gpt-6-unknown" }, "gpt-6-unknown")).toEqual({});
    expect(readCopilotEndpointKinds({ id: "gpt-6-unknown" })).toEqual([]);
  });
});

describe("Copilot endpoint contract for a whole catalog", () => {
  it("keeps only the models that declare an endpoint", () => {
    const contract = buildCopilotEndpointContract([
      { id: "gpt-6-luna", supported_endpoints: ["/responses"] },
      { id: "gpt-6-unknown" },
      { id: "gpt-6-chat", supported_endpoints: ["/chat/completions"] },
      { id: "gpt-6-luna", supported_endpoints: ["/responses"] },
      null,
    ]);
    expect(contract.models).toEqual([
      { id: "gpt-6-luna", supportedEndpoints: ["responses"], targetFormat: "openai-responses" },
      { id: "gpt-6-chat", supportedEndpoints: ["chat"] },
    ]);
  });

  it("resolves the route a model uses, and nothing for a model it says nothing about", () => {
    const contract = buildCopilotEndpointContract([
      { id: "gpt-6-luna", supported_endpoints: ["/responses"] },
      { id: "gpt-6-chat", supported_endpoints: ["/chat/completions"] },
    ]);
    expect(resolveCopilotEndpointRoute(contract, "gpt-6-luna")).toBe("responses");
    expect(resolveCopilotEndpointRoute(contract, "gpt-6-chat")).toBe("chat");
    expect(resolveCopilotEndpointRoute(contract, "gpt-6-unknown")).toBeNull();
    expect(resolveCopilotEndpointRoute(null, "gpt-6-luna")).toBeNull();
  });
});

describe("Copilot discovery carries the endpoint contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearCopilotModelCache();
  });

  it("keeps the advertised endpoints on the discovered models", async () => {
    mocks.proxyAwareFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          { id: "gpt-6-luna", capabilities: { type: "chat" }, supported_endpoints: ["/responses"] },
          { id: "gpt-6-chat", capabilities: { type: "chat" }, supported_endpoints: ["/chat/completions"] },
          { id: "gpt-6-unknown", capabilities: { type: "chat" } },
        ],
      }),
    });

    const result = await resolveCopilotModels({ providerSpecificData: { copilotToken: "cp-1" } }, {
      forceRefresh: true,
      includeMetadata: true,
    });

    expect(result.models).toEqual([
      expect.objectContaining({ id: "gpt-6-luna", supportedEndpoints: ["responses"], targetFormat: "openai-responses" }),
      expect.objectContaining({ id: "gpt-6-chat", supportedEndpoints: ["chat"] }),
      expect.objectContaining({ id: "gpt-6-unknown" }),
    ]);
    expect(result.models[2].supportedEndpoints).toBeUndefined();
  });
});

describe("GitHub Copilot routing from the discovered contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.proxyAwareFetch.mockResolvedValue(new Response("upstream said no", { status: 400 }));
  });

  it("sends a Responses-only model to /responses with a Responses body", async () => {
    const contract = buildCopilotEndpointContract([
      { id: "gpt-6-luna", supported_endpoints: ["/responses"] },
    ]);
    const exec = new GithubExecutor();

    await exec.execute({
      model: "gpt-6-luna",
      body: CHAT_BODY,
      stream: true,
      credentials: credentialsWithContract(contract),
      log: null,
    });

    expect(mocks.proxyAwareFetch).toHaveBeenCalledTimes(1);
    expect(mocks.proxyAwareFetch.mock.calls[0][0]).toBe("https://api.githubcopilot.com/responses");
    const sent = sentBody();
    expect(Array.isArray(sent.input)).toBe(true);
    expect(sent.messages).toBeUndefined();
    expect(sent.max_tokens).toBeUndefined();
    expect(sent.max_output_tokens).toBe(16);
  });

  it("keeps a chat-capable model on the chat route", async () => {
    const contract = buildCopilotEndpointContract([
      { id: "gpt-6-chat", supported_endpoints: ["/chat/completions"] },
    ]);
    const exec = new GithubExecutor();

    await exec.execute({
      model: "gpt-6-chat",
      body: CHAT_BODY,
      stream: true,
      credentials: credentialsWithContract(contract),
      log: null,
    });

    expect(mocks.proxyAwareFetch.mock.calls[0][0]).toBe("https://api.githubcopilot.com/chat/completions");
    expect(sentBody().messages).toBeDefined();
  });

  it("keeps the provider-error fallback for a model with no discovered metadata", async () => {
    const exec = new GithubExecutor();

    await exec.execute({
      model: "gpt-6-unknown",
      body: CHAT_BODY,
      stream: true,
      credentials: credentialsWithContract(null),
      log: null,
    });

    // The chat route is tried first, and the provider's own error still escalates.
    expect(mocks.proxyAwareFetch.mock.calls[0][0]).toBe("https://api.githubcopilot.com/chat/completions");
  });

  it("escalates to /responses on Copilot's own not-accessible error", async () => {
    mocks.proxyAwareFetch
      .mockResolvedValueOnce(new Response("not accessible via the /chat/completions endpoint", { status: 400 }))
      .mockResolvedValueOnce(new Response("still no", { status: 400 }));
    const exec = new GithubExecutor();

    await exec.execute({
      model: "gpt-6-unknown",
      body: CHAT_BODY,
      stream: true,
      credentials: credentialsWithContract(null),
      log: { debug: vi.fn(), warn: vi.fn() },
    });

    expect(mocks.proxyAwareFetch.mock.calls.map((call) => call[0])).toEqual([
      "https://api.githubcopilot.com/chat/completions",
      "https://api.githubcopilot.com/responses",
    ]);
  });

  it("keeps Claude on the Messages route even when the contract names Responses", async () => {
    const contract = buildCopilotEndpointContract([
      { id: "claude-future", supported_endpoints: ["/responses"] },
    ]);
    const exec = new GithubExecutor();

    await exec.execute({
      model: "claude-future",
      body: CHAT_BODY,
      stream: true,
      credentials: credentialsWithContract(contract),
      log: null,
    });

    expect(mocks.proxyAwareFetch.mock.calls[0][0]).toBe("https://api.githubcopilot.com/v1/messages");
  });

  it("keeps a model the Responses endpoint does not serve on the chat route", async () => {
    const contract = buildCopilotEndpointContract([
      { id: "gemini-future", supported_endpoints: ["/responses"] },
    ]);
    const exec = new GithubExecutor();

    await exec.execute({
      model: "gemini-future",
      body: CHAT_BODY,
      stream: true,
      credentials: credentialsWithContract(contract),
      log: null,
    });

    expect(mocks.proxyAwareFetch.mock.calls[0][0]).toBe("https://api.githubcopilot.com/chat/completions");
  });
});

describe("GitHub Enterprise Copilot routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.proxyAwareFetch.mockResolvedValue(new Response("upstream said no", { status: 400 }));
  });

  it("routes the GPT-6 family to the existing enterprise /responses route", async () => {
    const exec = new GheCopilotExecutor();

    await exec.execute({
      model: "gpt-6-luna",
      body: CHAT_BODY,
      stream: true,
      credentials: GHE_CREDENTIALS,
      log: null,
    });

    expect(mocks.proxyAwareFetch.mock.calls[0][0]).toBe("https://copilot-api.acme.ghe.com/responses");
    const sent = sentBody();
    expect(Array.isArray(sent.input)).toBe(true);
    expect(sent.messages).toBeUndefined();
    expect(sent.max_output_tokens).toBe(16);
  });

  it("keeps other enterprise models on the chat route", async () => {
    const exec = new GheCopilotExecutor();

    await exec.execute({
      model: "gpt-5.4",
      body: CHAT_BODY,
      stream: true,
      credentials: GHE_CREDENTIALS,
      log: null,
    });

    expect(mocks.proxyAwareFetch.mock.calls[0][0]).toBe("https://copilot-api.acme.ghe.com/chat/completions");
  });

  it("lets a discovered contract state the chat route for a GPT-6 model", async () => {
    const contract = buildCopilotEndpointContract([
      { id: "gpt-6-luna", supported_endpoints: ["/chat/completions"] },
    ]);
    const exec = new GheCopilotExecutor();

    await exec.execute({
      model: "gpt-6-luna",
      body: CHAT_BODY,
      stream: true,
      credentials: {
        ...GHE_CREDENTIALS,
        providerSpecificData: { ...GHE_CREDENTIALS.providerSpecificData, copilotEndpointContract: contract },
      },
      log: null,
    });

    expect(mocks.proxyAwareFetch.mock.calls[0][0]).toBe("https://copilot-api.acme.ghe.com/chat/completions");
  });

  it("keeps Claude on the enterprise Messages route and Gemini on the chat route", async () => {
    const exec = new GheCopilotExecutor();

    await exec.execute({
      model: "claude-opus-5",
      body: CHAT_BODY,
      stream: true,
      credentials: GHE_CREDENTIALS,
      log: null,
    });
    expect(mocks.proxyAwareFetch.mock.calls[0][0]).toBe("https://copilot-api.acme.ghe.com/v1/messages");

    mocks.proxyAwareFetch.mockClear();
    await exec.execute({
      model: "gemini-3.7-flash",
      body: CHAT_BODY,
      stream: true,
      credentials: GHE_CREDENTIALS,
      log: null,
    });
    expect(mocks.proxyAwareFetch.mock.calls[0][0]).toBe("https://copilot-api.acme.ghe.com/chat/completions");
  });

  it("does not give github.com Copilot the enterprise GPT-6 rule", async () => {
    const exec = new GithubExecutor();

    await exec.execute({
      model: "gpt-6-luna",
      body: CHAT_BODY,
      stream: true,
      credentials: { accessToken: "tok" },
      log: null,
    });

    expect(mocks.proxyAwareFetch.mock.calls[0][0]).toBe("https://api.githubcopilot.com/chat/completions");
  });
});

describe("Copilot endpoint contract persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateProviderConnection.mockResolvedValue({});
  });

  it("stores the discovered contract on the connection", async () => {
    const contract = await persistCopilotEndpointContract(
      { id: "conn-1", providerSpecificData: { copilotToken: "cp" } },
      [{ id: "gpt-6-luna", supportedEndpoints: ["responses"], targetFormat: "openai-responses" }],
    );

    expect(contract.models).toEqual([
      { id: "gpt-6-luna", supportedEndpoints: ["responses"], targetFormat: "openai-responses" },
    ]);
    expect(mocks.updateProviderConnection).toHaveBeenCalledTimes(1);
    const [connectionId, patch] = mocks.updateProviderConnection.mock.calls[0];
    expect(connectionId).toBe("conn-1");
    expect(patch.providerSpecificData.copilotEndpointContract).toEqual(contract);
  });

  it("skips the write when the stored contract already matches", async () => {
    const rows = [{ id: "gpt-6-luna", supportedEndpoints: ["responses"], targetFormat: "openai-responses" }];
    const stored = await persistCopilotEndpointContract({ id: "conn-1", providerSpecificData: {} }, rows);
    mocks.updateProviderConnection.mockClear();

    await persistCopilotEndpointContract({ id: "conn-1", providerSpecificData: { copilotEndpointContract: stored } }, rows);

    expect(mocks.updateProviderConnection).not.toHaveBeenCalled();
  });

  it("replaces a stored contract whose models Copilot no longer serves", async () => {
    const stored = await persistCopilotEndpointContract(
      { id: "conn-1", providerSpecificData: {} },
      [{ id: "gpt-6-luna", supportedEndpoints: ["responses"], targetFormat: "openai-responses" }],
    );
    mocks.updateProviderConnection.mockClear();

    const next = await persistCopilotEndpointContract(
      { id: "conn-1", providerSpecificData: { copilotEndpointContract: stored } },
      [{ id: "gpt-6-chat", supportedEndpoints: ["chat"] }],
    );

    expect(next.models).toEqual([{ id: "gpt-6-chat", supportedEndpoints: ["chat"] }]);
    expect(mocks.updateProviderConnection).toHaveBeenCalledTimes(1);
  });
});
