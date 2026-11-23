import { describe, expect, it } from "vitest";
import { XaiExecutor } from "../../open-sse/executors/xai.js";

describe("xAI streaming usage", () => {
  const executor = new XaiExecutor();
  it("requests actual usage for chat streams and preserves other options", () => {
    expect(executor.transformRequest("grok-4", { stream_options: { custom: true } }, true)).toMatchObject({
      stream: true, stream_options: { custom: true, include_usage: true },
    });
    expect(executor.transformRequest("grok-4", { stream_options: ["invalid"] }, true).stream_options).toEqual({ include_usage: true });
  });
  it("removes stream options for non-streaming, opt-out and Responses requests", () => {
    const body = { stream_options: { include_usage: true } };
    expect(executor.transformRequest("grok-4", body, false).stream_options).toBeUndefined();
    expect(executor.transformRequest("grok-4", { ...body, stream: false }, true).stream_options).toBeUndefined();
    expect(executor.transformRequest("grok-4", body, true, { providerSpecificData: { disableStreamOptions: true } }).stream_options).toBeUndefined();
    expect(executor.transformRequest("grok-4", body, true, { runtimeTransport: { format: "openai-responses-oauth" } }).stream_options).toBeUndefined();
  });
});
