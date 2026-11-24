import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";

const getMimoAccountCookie = vi.hoisted(() => vi.fn());
const invalidateMimoAccountCookieCache = vi.hoisted(() => vi.fn());
const proxyAwareFetch = vi.hoisted(() => vi.fn());

vi.mock("../../open-sse/utils/mimoAccount.js", async (importOriginal) => ({
  ...(await importOriginal()),
  getMimoAccountCookie,
  invalidateMimoAccountCookieCache,
}));
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch,
}));

import { resolveRequestTransport } from "../../open-sse/handlers/chatCore.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { PROVIDERS } from "../../open-sse/config/providers.js";
import { XiaomiMimoExecutor, __test__ } from "../../open-sse/executors/xiaomi-mimo.js";

const { COOKIE_KEY } = __test__;
const MARKER = { type: "ephemeral" };
const OPENAI_URL = "https://api.xiaomimimo.com/v1/chat/completions";
const CLAUDE_URL = "https://api.xiaomimimo.com/anthropic/v1/messages";
const OPENAI_T = { runtimeTransport: { format: "openai", baseUrl: OPENAI_URL } };
const CLAUDE_T = { runtimeTransport: { format: "claude", baseUrl: CLAUDE_URL } };
const session = (region, extra = {}) => ({
  providerSpecificData: { mimoPassToken: "pt", ...(region ? { region } : null) },
  [COOKIE_KEY]: "serviceToken=abc",
  ...extra,
});
const dualCreds = () => ({
  apiKey: "sk-x",
  providerSpecificData: { mimoPassToken: "pt", region: "cn" },
});

function buildClaudeBody() {
  return {
    system: [
      {
        type: "text",
        text: "x-anthropic-billing-header: transient\nStable instructions",
        cache_control: MARKER,
      },
      {
        type: "text",
        text: "Uncached system tail",
      },
    ],
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "First, uncached context." },
          { type: "text", text: "Cache me please.", cache_control: MARKER },
        ],
      },
    ],
    max_tokens: 1024,
  };
}

function hasCacheControl(value) {
  return JSON.stringify(value).includes("cache_control");
}

function okJsonResponse() {
  return new Response(JSON.stringify({ id: "cmpl-test", choices: [] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function dispatchCredentials(provider, model, sourceFormat, baseCredentials) {
  const credentials = baseCredentials ? structuredClone(baseCredentials) : null;
  const { runtimeTransport, targetFormat } = resolveRequestTransport({
    provider,
    alias: provider,
    model,
    sourceFormat,
    credentials,
  });
  if (runtimeTransport && credentials) {
    credentials.runtimeTransport = runtimeTransport;
  }
  return { credentials, runtimeTransport, targetFormat };
}

describe("Xiaomi cloud OpenAI explicit cache markers (OmniRoute #5013)", () => {
  let executor;

  beforeEach(() => {
    executor = new XiaomiMimoExecutor();
    getMimoAccountCookie.mockReset();
    invalidateMimoAccountCookieCache.mockReset();
    proxyAwareFetch.mockReset();
    proxyAwareFetch.mockImplementation(async () => okJsonResponse());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("scopes preserveCacheControl to Xiaomi's cloud OpenAI transport instead of provider-wide quirks", () => {
    const config = PROVIDERS["xiaomi-mimo"];
    expect(config.quirks?.preserveCacheControl).toBeUndefined();
    const openAITransport = config.transports.find((t) => t.format === FORMATS.OPENAI);
    const claudeTransport = config.transports.find((t) => t.format === FORMATS.CLAUDE);
    expect(openAITransport?.quirks).toEqual({ preserveCacheControl: true });
    expect(claudeTransport?.quirks?.preserveCacheControl).toBeUndefined();
  });

  it.each([
    ["mimo-v2.6-pro", { apiKey: "sk-x" }],
    ["mimo-v2.6-flash", { apiKey: "sk-x" }],
    ["mimo-v2.5-pro", { apiKey: "sk-x" }],
    ["mimo-v2.5-pro", dualCreds()],
  ])("preserves system and user cache_control through translation and cloud execution for %s", async (model, baseCredentials) => {
    const body = buildClaudeBody();
    const original = structuredClone(body);
    const { credentials, targetFormat } = dispatchCredentials("xiaomi-mimo", model, FORMATS.CLAUDE, baseCredentials);
    expect(targetFormat).toBe(FORMATS.OPENAI);

    const translated = translateRequest(FORMATS.CLAUDE, targetFormat, model, body, false, credentials, "xiaomi-mimo");
    expect(body).toEqual(original);
    expect(translated.messages).toEqual([
      {
        role: "system",
        content: [
          { type: "text", text: "Stable instructions", cache_control: MARKER },
          { type: "text", text: "Uncached system tail" },
        ],
      },
      {
        role: "user",
        content: [
          { type: "text", text: "First, uncached context." },
          { type: "text", text: "Cache me please.", cache_control: MARKER },
        ],
      },
    ]);

    await executor.execute({ model, body: translated, stream: false, credentials });
    expect(getMimoAccountCookie).not.toHaveBeenCalled();
    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);

    const [wireUrl, wireInit] = proxyAwareFetch.mock.calls[0];
    const wireBody = JSON.parse(wireInit.body);
    expect(wireUrl).toBe(OPENAI_URL);
    expect(wireInit.headers.Authorization).toBe("Bearer sk-x");
    expect(wireInit.headers.Cookie).toBeUndefined();
    expect(wireBody.model).toBe(model);
    expect(wireBody.messages).toEqual(translated.messages);
  });

  it("preserves markers when definite cloud OpenAI transport is already attached without passToken", () => {
    const body = buildClaudeBody();
    const translated = translateRequest(FORMATS.CLAUDE, FORMATS.OPENAI, "mimo-v2.6-pro", body, false, OPENAI_T, "xiaomi-mimo");
    expect(translated.messages[0].content).toEqual([
      { type: "text", text: "Stable instructions", cache_control: MARKER },
      { type: "text", text: "Uncached system tail" },
    ]);
    expect(translated.messages[1].content).toEqual([
      { type: "text", text: "First, uncached context." },
      { type: "text", text: "Cache me please.", cache_control: MARKER },
    ]);
  });

  it("retains marked assistant text alongside tool calls on definitely cloud Xiaomi OpenAI", () => {
    const result = translateRequest(
      FORMATS.CLAUDE,
      FORMATS.OPENAI,
      "mimo-v2.6-pro",
      {
        messages: [
          {
            role: "assistant",
            content: [
              { type: "text", text: "Calling tool", cache_control: MARKER },
              { type: "tool_use", id: "call_1", name: "read", input: {} },
            ],
          },
          {
            role: "user",
            content: [{ type: "tool_result", tool_use_id: "call_1", content: "done" }],
          },
        ],
      },
      false,
      { apiKey: "sk-x", ...OPENAI_T },
      "xiaomi-mimo",
    );
    expect(result.messages[0].content).toEqual([{ type: "text", text: "Calling tool", cache_control: MARKER }]);
    expect(result.messages[0].tool_calls[0].id).toBe("call_1");
    expect(result.messages[1]).toEqual({ role: "tool", tool_call_id: "call_1", content: "done" });
  });

  it("keeps Xiaomi native Messages behavior unchanged on both translateRequest and passthrough execution", async () => {
    const body = buildClaudeBody();
    const claudeTransport = PROVIDERS["xiaomi-mimo"].transports.find((t) => t.format === FORMATS.CLAUDE);
    const credentials = { apiKey: "sk-x", runtimeTransport: claudeTransport };

    // Native Claude target runs prepareClaudeRequest (sets 1h ttl on last system block),
    // unaffected by the OpenAI transport's preserveCacheControl quirk.
    const translated = translateRequest(
      FORMATS.CLAUDE,
      FORMATS.CLAUDE,
      "mimo-v2.5-pro",
      structuredClone(body),
      false,
      credentials,
      "xiaomi-mimo",
    );
    expect(translated.system).toEqual([
      { type: "text", text: "x-anthropic-billing-header: transient\nStable instructions" },
      { type: "text", text: "Uncached system tail", cache_control: { type: "ephemeral", ttl: "1h" } },
    ]);
    expect(translated.messages[0].content).toEqual([
      { type: "text", text: "First, uncached context." },
      { type: "text", text: "Cache me please." },
    ]);

    // Native passthrough keeps the caller's native Messages payload intact when dispatched.
    const passthroughBody = buildClaudeBody();
    await executor.execute({ model: "mimo-v2.5-pro", body: passthroughBody, stream: false, credentials });
    expect(getMimoAccountCookie).not.toHaveBeenCalled();

    const [wireUrl, wireInit] = proxyAwareFetch.mock.calls[0];
    const wireBody = JSON.parse(wireInit.body);
    expect(wireUrl).toBe(CLAUDE_URL);
    expect(wireInit.headers["x-api-key"]).toBe("sk-x");
    expect(wireInit.headers.Authorization).toBeUndefined();
    expect(wireBody.system).toEqual(passthroughBody.system);
    expect(wireBody.messages).toEqual(passthroughBody.messages);
  });

  it.each(["mimo-v2.6-pro", "mimo-v2.6-flash"])(
    "keeps prior marker stripping on the resolved Xiaomi account-service route for %s",
    async (model) => {
      const credentials = { ...session("sgp"), ...OPENAI_T };
      const translated = translateRequest(
        FORMATS.CLAUDE,
        FORMATS.OPENAI,
        model,
        buildClaudeBody(),
        false,
        credentials,
        "xiaomi-mimo",
      );
      expect(translated.messages).toEqual([
        { role: "system", content: "Stable instructions\nUncached system tail" },
        { role: "user", content: "First, uncached context.\nCache me please." },
      ]);
      expect(hasCacheControl(translated)).toBe(false);

      await executor.execute({ model, body: translated, stream: false, credentials });
      const [wireUrl, wireInit] = proxyAwareFetch.mock.calls[0];
      const wireBody = JSON.parse(wireInit.body);
      expect(wireUrl).toBe("https://mimo-server-sgp.xiaomimimo.com/api/route/chat/completions");
      expect(wireInit.headers.Cookie).toBe("serviceToken=abc");
      expect(wireInit.headers.Authorization).toBeUndefined();
      expect(wireBody.model).toBe(`xiaomi/${model}`);
      expect(hasCacheControl(wireBody)).toBe(false);
    },
  );

  it.each([
    ["dual-auth session candidate (sk- + passToken)", dualCreds(), true],
    ["cloud runtimeTransport with passToken", { ...OPENAI_T, providerSpecificData: { mimoPassToken: "pt" } }, true],
    ["session-only oauth credential", { authType: "oauth", providerSpecificData: { mimoPassToken: "pt", authMethod: "session" } }, true],
    ["empty credentials", {}, false],
    ["null credentials", null, false],
  ])(
    "keeps prior marker stripping when route for v2.6 is unknown or non-cloud (%s)",
    (_label, baseCredentials, useDispatch) => {
      const credentials = useDispatch
        ? dispatchCredentials("xiaomi-mimo", "mimo-v2.6-pro", FORMATS.CLAUDE, baseCredentials).credentials
        : baseCredentials;
      const translated = translateRequest(
        FORMATS.CLAUDE,
        FORMATS.OPENAI,
        "mimo-v2.6-pro",
        buildClaudeBody(),
        false,
        credentials,
        "xiaomi-mimo",
      );
      expect(translated.messages).toEqual([
        { role: "system", content: "Stable instructions\nUncached system tail" },
        { role: "user", content: "First, uncached context.\nCache me please." },
      ]);
      expect(hasCacheControl(translated)).toBe(false);
    },
  );

  it("keeps prior marker stripping during translation even if a session candidate later falls back to cloud in execute()", async () => {
    getMimoAccountCookie.mockResolvedValue(null);
    const { credentials, targetFormat } = dispatchCredentials("xiaomi-mimo", "mimo-v2.6-pro", FORMATS.CLAUDE, dualCreds());
    const translated = translateRequest(
      FORMATS.CLAUDE,
      targetFormat,
      "mimo-v2.6-pro",
      buildClaudeBody(),
      false,
      credentials,
      "xiaomi-mimo",
    );
    expect(hasCacheControl(translated)).toBe(false);

    await executor.execute({ model: "mimo-v2.6-pro", body: translated, stream: false, credentials });
    expect(getMimoAccountCookie).toHaveBeenCalledTimes(1);
    const [wireUrl, wireInit] = proxyAwareFetch.mock.calls[0];
    expect(wireUrl).toBe(OPENAI_URL);
    expect(wireInit.headers.Authorization).toBe("Bearer sk-x");
    expect(hasCacheControl(JSON.parse(wireInit.body))).toBe(false);
  });

  it("does not invent cache markers or alter unmarked messages on definitely cloud Xiaomi OpenAI", () => {
    const result = translateRequest(
      FORMATS.CLAUDE,
      FORMATS.OPENAI,
      "mimo-v2.6-pro",
      {
        system: "instructions",
        messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      },
      false,
      { apiKey: "sk-x", ...OPENAI_T },
      "xiaomi-mimo",
    );
    expect(result.messages).toEqual([
      { role: "system", content: "instructions" },
      { role: "user", content: "hi" },
    ]);
    expect(hasCacheControl(result)).toBe(false);
  });

  it.each([
    ["openai", "gpt-4o-mini"],
    ["codex", "gpt-5.3-codex"],
    ["azure", "gpt-4o"],
    ["groq", "llama-3.3-70b-versatile"],
    ["xiaomi-tokenplan", "mimo-v2.6-pro"],
    ["xiaomi-mimo-token-plan", "mimo-v2.5-pro"],
    ["mimo-free", "mimo-auto"],
    ["mimocode", "mimo-auto"],
  ])("strips cache_control for implicit-cache or non-opted provider %s", (provider, model) => {
    const result = translateRequest(
      FORMATS.CLAUDE,
      FORMATS.OPENAI,
      model,
      buildClaudeBody(),
      false,
      { apiKey: "sk-x" },
      provider,
    );
    expect(result.messages).toEqual([
      { role: "system", content: "Stable instructions\nUncached system tail" },
      { role: "user", content: "First, uncached context.\nCache me please." },
    ]);
    expect(hasCacheControl(result)).toBe(false);
  });

  it.each(["alicode", "alicode-intl", "alibaba", "alitp-intl"])(
    "preserves existing DashScope explicit cache markers for %s",
    (provider) => {
      const result = translateRequest(
        FORMATS.CLAUDE,
        FORMATS.OPENAI,
        "qwen3-coder-plus",
        buildClaudeBody(),
        false,
        null,
        provider,
      );
      expect(result.messages).toEqual([
        {
          role: "system",
          content: [
            { type: "text", text: "Stable instructions", cache_control: MARKER },
            { type: "text", text: "Uncached system tail" },
          ],
        },
        {
          role: "user",
          content: [
            { type: "text", text: "First, uncached context." },
            { type: "text", text: "Cache me please.", cache_control: MARKER },
          ],
        },
      ]);
    },
  );
});
