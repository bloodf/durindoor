import { test } from "node:test";
import assert from "node:assert/strict";
import { DefaultExecutor } from "./default.js";

const request = () => ({ model: "model-a", messages: [{ role: "user", content: "hi" }] });

test("emits store for opted-in Responses transport", () => {
  const output = new DefaultExecutor("openai").transformRequest("model-a", request(), true, {
    providerSpecificData: { openaiStoreEnabled: true },
    runtimeTransport: { format: "openai-responses" },
  });

  assert.equal(output.store, true);
});

test("does not emit store for Chat transport", () => {
  const output = new DefaultExecutor("openai-compatible-responses-node").transformRequest("model-a", request(), true, {
    providerSpecificData: { openaiStoreEnabled: true },
    runtimeTransport: { format: "openai" },
  });

  assert.equal(output.store, undefined);
});

test("does not emit store without explicit opt-in", () => {
  const output = new DefaultExecutor("openai-compatible-responses-node").transformRequest("model-a", request(), true, {
    runtimeTransport: { format: "openai-responses" },
  });

  assert.equal(output.store, undefined);
});

test("does not emit store for Codex", () => {
  const output = new DefaultExecutor("codex").transformRequest("model-a", request(), true, {
    providerSpecificData: { openaiStoreEnabled: true },
    runtimeTransport: { format: "openai-responses" },
  });

  assert.equal(output.store, undefined);
});
