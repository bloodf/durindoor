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

  it("clamps an explicit max_completion_tokens above the 65536 ceiling (normalized to max_tokens)", () => {
    const executor = new DefaultExecutor("sensenova");
    const body = {
      model: "sensenova-6.7-flash-lite",
      messages: [],
      max_completion_tokens: 100000,
    };
    executor.transformRequest("sensenova-6.7-flash-lite", body, true, {});
    // sensenova is not a max-completion-token family, so #6964 reverse-normalizes
    // the clamped value to the legacy field and removes the newer spelling.
    expect(body.max_tokens).toBe(65536);
    expect("max_completion_tokens" in body).toBe(false);
  });

  it("leaves both token fields omitted when the client omits them (no default injection)", () => {
    const executor = new DefaultExecutor("sensenova");
    const body = { model: "sensenova-6.7-flash-lite", messages: [] };
    executor.transformRequest("sensenova-6.7-flash-lite", body, true, {});
    expect("max_tokens" in body).toBe(false);
    expect("max_completion_tokens" in body).toBe(false);
  });

  it("clamps 70000 down to the 65536 ceiling but leaves 1000 untouched", () => {
    const executor = new DefaultExecutor("sensenova");
    const over = { model: "sensenova-6.7-flash-lite", messages: [], max_tokens: 70000 };
    executor.transformRequest("sensenova-6.7-flash-lite", over, true, {});
    expect(over.max_tokens).toBe(65536);
    const under = { model: "sensenova-6.7-flash-lite", messages: [], max_tokens: 1000 };
    executor.transformRequest("sensenova-6.7-flash-lite", under, true, {});
    expect(under.max_tokens).toBe(1000);
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
