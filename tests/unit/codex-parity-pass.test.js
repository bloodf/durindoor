import { describe, expect, it, vi } from "vitest";
import { CodexExecutor } from "../../open-sse/executors/codex.js";
import { refreshCodexToken } from "../../open-sse/services/tokenRefresh/providers.js";

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: fetchMock }));

describe("Codex upstream usage reset envelopes", () => {
  it.each([
    { type: "usage_limit_reached", resets_in_seconds: 60 },
    { body: { error: { type: " USAGE_LIMIT_REACHED ", resets_in_seconds: 60 } } },
    { error: { type: "usage_limit_reached", resets_in_seconds: 60 } },
  ])("uses reset timing from the upstream error envelope", (body) => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    try {
      expect(new CodexExecutor().parseError({ status: 429, headers: new Headers() }, JSON.stringify(body)).resetsAtMs)
        .toBe(1_700_000_060_000);
    } finally {
      clock.mockRestore();
    }
  });
});

describe("Codex refresh errors", () => {
  it.each(["token_revoked", "invalid_client"])("does not retry %s", async (code) => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 400, text: async () => JSON.stringify({ error: code }) });
    expect(await refreshCodexToken(`refresh-${code}`, null)).toMatchObject({ error: "unrecoverable_refresh_error", code });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockClear();
  });
});

describe("Codex Responses Lite", () => {
  it("serializes ordinary tool calls while retaining delegation model settings", () => {
    const executor = new CodexExecutor();
    const context = { clientHeaders: { "x-openai-internal-codex-responses-lite": "true" } };
    const make = (model) => executor.transformRequest(model, { model, input: "hello", parallel_tool_calls: true }, true, {}, context);
    expect(make("gpt-5.4").parallel_tool_calls).toBe(false);
    expect(make("gpt-6.1-sol-ultra").parallel_tool_calls).toBe(true);
    expect(make("gpt-5.6-luna-max").parallel_tool_calls).toBe(true);
  });
});
