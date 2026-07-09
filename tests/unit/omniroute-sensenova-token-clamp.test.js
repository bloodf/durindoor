import { describe, it, expect } from "vitest";
import { DefaultExecutor } from "../../open-sse/executors/default.js";

describe("OmniRoute #6330 — SenseNova Token Plan clamp (Thread 1)", () => {
  it("clamps an explicit max_tokens above the 65536 ceiling", () => {
    const executor = new DefaultExecutor("sensenova");
    const body = {
      model: "sensenova-6.7-flash-lite",
      messages: [],
      max_tokens: 999999,
    };
    executor.transformRequest("sensenova-6.7-flash-lite", body, true, {});
    expect(body.max_tokens).toBe(65536);
  });

  it("clamps an explicit max_completion_tokens above the 65536 ceiling", () => {
    const executor = new DefaultExecutor("sensenova");
    const body = {
      model: "sensenova-6.7-flash-lite",
      messages: [],
      max_completion_tokens: 100000,
    };
    executor.transformRequest("sensenova-6.7-flash-lite", body, true, {});
    expect(body.max_completion_tokens).toBe(65536);
  });

  it("applies requestDefaults.maxTokens = 65536 when both token fields are absent", () => {
    const executor = new DefaultExecutor("sensenova");
    const body = { model: "sensenova-6.7-flash-lite", messages: [] };
    executor.transformRequest("sensenova-6.7-flash-lite", body, true, {});
    expect(body.max_tokens).toBe(65536);
  });

  it("does not touch an explicit value within the ceiling", () => {
    const executor = new DefaultExecutor("sensenova");
    const body = {
      model: "sensenova-6.7-flash-lite",
      messages: [],
      max_tokens: 4096,
    };
    executor.transformRequest("sensenova-6.7-flash-lite", body, true, {});
    expect(body.max_tokens).toBe(4096);
  });
});
