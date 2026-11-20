import { afterEach, describe, expect, it, vi } from "vitest";

import { AzureExecutor } from "../../open-sse/executors/azure.js";
import { CodexExecutor } from "../../open-sse/executors/codex.js";
import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";

// Upstream decolua/9router#2809 — Azure GPT-5/GPT-6 and o-series deployments
// reject `max_tokens`, a custom `temperature`, and `reasoning_effort` next to
// tools on /chat/completions.
//
// The fork keeps the family evidence local: the deployment identifier this
// executor actually calls. Azure deployment names are operator-chosen and
// opaque, so an unrecognized name must not be guessed into a family, and a
// deployment serving another family keeps the existing parameter contract.

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: vi.fn() }));
afterEach(() => vi.resetAllMocks());

const AZURE_PROVIDER_DATA = {
  azureEndpoint: "https://example-resource.openai.azure.com",
  apiVersion: "2025-04-01-preview",
};
const credentials = (deployment) => ({
  apiKey: "fixture-key",
  providerSpecificData: { ...AZURE_PROVIDER_DATA, ...(deployment ? { deployment } : {}) },
});
const rejected = (param) => Response.json({
  error: { code: "unsupported_parameter", param, message: `Unsupported parameter: '${param}'` },
}, { status: 400 });
const ok = () => Response.json({ choices: [] });
const sent = () => proxyAwareFetch.mock.calls.map(([, options]) => JSON.parse(options.body));

const TOOLS = [{ type: "function", function: { name: "get_weather" } }];
const MESSAGES = [{ role: "user", content: "Hello" }];

describe("Azure GPT-5-family request normalization (upstream #2809)", () => {
  it("normalizes a GPT-5 deployment named by the connection and preserves tools", () => {
    const executor = new AzureExecutor();
    const body = Object.freeze({
      max_tokens: 4096,
      temperature: 0.2,
      reasoning_effort: "medium",
      tools: Object.freeze([...TOOLS]),
      tool_choice: "auto",
      messages: Object.freeze([...MESSAGES]),
    });

    const result = executor.transformRequest("chat", body, false, credentials("gpt-5-prod"));

    expect(result).toEqual({
      max_completion_tokens: 4096,
      tools: TOOLS,
      tool_choice: "auto",
      messages: MESSAGES,
    });
    // The caller's body is never mutated.
    expect(body).toHaveProperty("max_tokens", 4096);
    expect(body).toHaveProperty("temperature", 0.2);
    expect(body).toHaveProperty("reasoning_effort", "medium");
  });

  it("keeps an explicit max_completion_tokens and drops only the legacy spelling", () => {
    const executor = new AzureExecutor();

    const result = executor.transformRequest("chat", {
      max_tokens: 1024,
      max_completion_tokens: 8192,
    }, false, credentials("gpt-5-prod"));

    expect(result).toEqual({ max_completion_tokens: 8192 });
  });

  it("drops a custom temperature but keeps the accepted default", () => {
    const executor = new AzureExecutor();

    expect(
      executor.transformRequest("chat", { temperature: 0.2 }, false, credentials("gpt-5-prod")),
    ).toEqual({});
    expect(
      executor.transformRequest("chat", { temperature: 1 }, false, credentials("gpt-5-prod")),
    ).toEqual({ temperature: 1 });
  });

  it("uses the requested model as the deployment when the connection names none", () => {
    const executor = new AzureExecutor();

    const result = executor.transformRequest("gpt-5", {
      max_tokens: 2048,
      temperature: 0.2,
    }, false, credentials());

    expect(result).toEqual({ max_completion_tokens: 2048 });
  });

  it("leaves another model family untouched", () => {
    const executor = new AzureExecutor();
    const body = {
      max_tokens: 1024,
      temperature: 0.2,
      reasoning_effort: "none",
      tools: TOOLS,
      tool_choice: "required",
    };

    const result = executor.transformRequest("gpt-4o", body, false, credentials("gpt-4o-deploy"));

    expect(result).toEqual(body);
  });

  it("is a no-op when the deployment name does not establish the family", () => {
    const executor = new AzureExecutor();
    const body = {
      max_tokens: 1024,
      temperature: 0.2,
      reasoning_effort: "medium",
      tools: TOOLS,
    };

    const result = executor.transformRequest("prod-chat", body, false, credentials("prod-chat"));

    expect(result).toEqual(body);
  });

  it("keeps the negotiated token-limit retry for a GPT-5 deployment", async () => {
    const executor = new AzureExecutor();
    proxyAwareFetch.mockResolvedValueOnce(rejected("max_completion_tokens")).mockResolvedValueOnce(ok());

    const result = await executor.execute({
      model: "chat",
      body: { max_tokens: 42 },
      stream: false,
      credentials: credentials("gpt-5-prod"),
    });

    expect(result.response.status).toBe(200);
    // The family default is tried first; the measured rejection still wins.
    expect(sent()).toEqual([{ max_completion_tokens: 42 }, { max_tokens: 42 }]);

    // The negotiated spelling is remembered per deployment URL.
    proxyAwareFetch.mockResolvedValueOnce(ok());
    await executor.execute({
      model: "chat",
      body: { max_tokens: 42 },
      stream: false,
      credentials: credentials("gpt-5-prod"),
    });
    expect(sent()[2]).toEqual({ max_tokens: 42 });
  });
});

// Upstream decolua/9router#5141 — a combo that fell back to Grok Build leaves
// reasoning items in the replayed history that Codex cannot decrypt, so the
// request is rejected with 400 invalid_encrypted_content and the combo falls
// back on every later turn.
//
// The fork removes such an item only when the local format establishes it:
// Grok Build ids are `rs_<uuid>`, OpenAI's are `rs_<hex>`. The blob is opaque
// ciphertext, so reasoning of unknown provenance stays, and the existing
// one-shot invalid_encrypted_content recovery still owns a stale OpenAI blob.

const GROK_REASONING_ID = "rs_aca4e4a2-50fa-9d40-a12a-cb7e1f0d2c3b";
const OPENAI_REASONING_ID = "rs_68c0f1e2a3b4c5d6e7f8091a2b3c4d5e";

const codexCredentials = {
  accessToken: "fixture-access-token",
  connectionId: "fixture-connection",
  providerSpecificData: { workspaceId: "fixture-workspace" },
};
const codexUser = (text) => ({ type: "message", role: "user", content: [{ type: "input_text", text }] });
const codexAssistant = (text) => ({ type: "message", role: "assistant", content: [{ type: "output_text", text }] });
const codexInput = (items) => new CodexExecutor().transformRequest(
  "gpt-6.1-sol",
  { model: "gpt-6.1-sol", input: items },
  true,
  codexCredentials,
);

describe("Codex replay of reasoning another provider sealed (upstream #5141)", () => {
  it("drops Grok-sealed reasoning and keeps OpenAI-sealed reasoning", () => {
    const body = codexInput([
      codexUser("first"),
      { type: "reasoning", id: GROK_REASONING_ID, summary: [], encrypted_content: "opaque-grok-blob" },
      codexAssistant("from grok"),
      { type: "reasoning", id: OPENAI_REASONING_ID, summary: [], encrypted_content: "opaque-openai-blob" },
      codexAssistant("from codex"),
      codexUser("next"),
    ]);

    const reasoning = body.input.filter((item) => item.type === "reasoning");
    expect(reasoning.map((item) => item.id)).toEqual([OPENAI_REASONING_ID]);
    expect(reasoning[0].encrypted_content).toBe("opaque-openai-blob");
    expect(body.input.filter((item) => item.type === "message").map((item) => item.content[0].text))
      .toEqual(expect.arrayContaining(["first", "from grok", "from codex", "next"]));
  });

  it("keeps reasoning whose provenance cannot be established locally", () => {
    const body = codexInput([
      codexUser("first"),
      // Replayed with store=false: the client dropped the item id.
      { type: "reasoning", summary: [], encrypted_content: "opaque-unknown-blob" },
      { type: "reasoning", id: "rs_not-a-uuid", summary: [], encrypted_content: "opaque-unknown-blob" },
      { type: "reasoning", summary: [{ type: "summary_text", text: "plain" }] },
      codexUser("next"),
    ]);

    const reasoning = body.input.filter((item) => item.type === "reasoning");
    expect(reasoning).toHaveLength(3);
    expect(reasoning[0].encrypted_content).toBe("opaque-unknown-blob");
    expect(reasoning[1].id).toBe("rs_not-a-uuid");
    expect(reasoning[2].summary[0].text).toBe("plain");
  });

  it("keeps tool calls and their outputs", () => {
    const body = codexInput([
      codexUser("first"),
      { type: "function_call", id: "fc_1", call_id: "call_1", name: "get_weather", arguments: "{}" },
      { type: "function_call_output", call_id: "call_1", output: "sunny" },
      codexUser("next"),
    ]);

    const calls = body.input.filter((item) => item.type === "function_call");
    const outputs = body.input.filter((item) => item.type === "function_call_output");
    expect(calls).toHaveLength(1);
    expect(calls[0].call_id).toBe("call_1");
    expect(outputs).toHaveLength(1);
    expect(outputs[0].output).toBe("sunny");
  });

  it("keeps the one-shot invalid_encrypted_content recovery for OpenAI-sealed reasoning", async () => {
    const fetchMock = vi.mocked(proxyAwareFetch);
    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      error: {
        code: "invalid_encrypted_content",
        message: "The encrypted content could not be verified. Reason: Encrypted content could not be decrypted or parsed.",
      },
    }), { status: 400, headers: { "Content-Type": "application/json" } }));
    fetchMock.mockResolvedValueOnce(new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("event: response.output_text.delta\n"));
        controller.enqueue(new TextEncoder().encode(
          `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "hi" })}\n\n`,
        ));
        controller.close();
      },
    }), { status: 200, headers: { "Content-Type": "text/event-stream" } }));

    const executor = new CodexExecutor();
    executor.config = { ...executor.config, baseUrl: "https://api.openai.test/v1/responses", baseUrls: undefined };
    const result = await executor.execute({
      model: "gpt-6.1-sol",
      body: {
        model: "gpt-6.1-sol",
        input: [
          codexUser("first"),
          { type: "reasoning", id: OPENAI_REASONING_ID, summary: [], encrypted_content: "opaque-openai-blob" },
          codexAssistant("from codex"),
          codexUser("next"),
        ],
      },
      stream: true,
      credentials: codexCredentials,
      requestContext: { compact: false },
    });
    await result.response.text();

    expect(result.response.status).toBe(200);
    const bodies = fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body));
    // The native item is not removed proactively; the measured 400 strips it.
    expect(bodies[0].input.some((item) => item.type === "reasoning")).toBe(true);
    expect(bodies[1].input.some((item) => item.type === "reasoning")).toBe(false);
  });
});
