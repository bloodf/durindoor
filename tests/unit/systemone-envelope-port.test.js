import { afterEach, expect, it, vi } from "vitest";
import { handleSystemoneCore } from "../../open-sse/handlers/systemoneCore.js";

afterEach(() => vi.unstubAllGlobals());
it("unwraps result answers and accounts for their usage", async () => {
  const inner = { answers: { urgent: { type: "noul", noul: 0.9 } }, usage: { input_tokens: 12, output_tokens: 1 } };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ result: inner, success: true }))));
  const result = await handleSystemoneCore({ body: { state: "s", questions: {} }, modelInfo: { provider: "opencode", model: "jev-1.13-free" }, credentials: { apiKey: "k" } });
  expect(result.success).toBe(true);
  expect(await result.response.json()).toEqual(inner);
  expect(result.usage).toEqual({ prompt_tokens: 12, completion_tokens: 1 });
});
it("preserves a native response with its own answers", async () => {
  const body = { answers: { own: true }, result: { answers: { other: true } } };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(body))));
  const result = await handleSystemoneCore({ body: {}, modelInfo: { provider: "opencode", model: "jev-1.13-free" }, credentials: { apiKey: "k" } });
  expect(await result.response.json()).toEqual(body);
});
