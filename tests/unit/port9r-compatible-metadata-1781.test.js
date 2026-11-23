import { describe, expect, it } from "vitest";
import { DefaultExecutor } from "../../open-sse/executors/default.js";

describe("compatible request metadata", () => {
  it("removes client metadata from chat nodes while preserving responses nodes", () => {
    const body = { model: "test", messages: [{ role: "user", content: "hello" }], client_metadata: { source: "codex" } };
    expect(new DefaultExecutor("openai-compatible-chat-test").transformRequest("test", structuredClone(body))).not.toHaveProperty("client_metadata");
    expect(new DefaultExecutor("openai-compatible-legacy").transformRequest("test", structuredClone(body))).not.toHaveProperty("client_metadata");
    expect(new DefaultExecutor("openai-compatible-responses-test").transformRequest("test", structuredClone(body)).client_metadata).toEqual({ source: "codex" });
  });
});
