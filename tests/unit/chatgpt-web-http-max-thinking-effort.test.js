import { test } from "vitest";
import assert from "node:assert/strict";

import {
  resolveChatGptModel,
  resolveChatGptSystemHints,
} from "../../open-sse/executors/chatgpt-web/models.js";

test("ChatGPT Web performance lanes use their native model and effort pairs", () => {
  const cases = [
    ["gpt-5.6-luna-free", "auto", null, false],
    ["gpt-5.6-luna-free-thinking", "auto", null, false],
    ["gpt-5.6-sol-instant", "gpt-5-6", null, false],
    ["gpt-5.6-sol-medium", "gpt-5-6-thinking", "standard", false],
    ["gpt-5.6-sol-high", "gpt-5-6-thinking", "extended", false],
    ["gpt-5.6-sol-xhigh", "gpt-5-6-thinking", "max", false],
    ["gpt-5.6-sol-pro", "gpt-5-6-pro", "standard", true],
    ["gpt-5.5-instant", "gpt-5-5", null, false],
    ["gpt-5.5-medium", "gpt-5-5-thinking", "standard", false],
    ["gpt-5.5-high", "gpt-5-5-thinking", "extended", false],
    ["gpt-5.5-xhigh", "gpt-5-5-thinking", "max", false],
    ["gpt-5.5-pro", "gpt-5-5-pro", "standard", true],
    ["gpt-5.5-pro-extended", "gpt-5-5-pro", "extended", true],
  ];

  for (const [model, slug, effort, isPro] of cases) {
    assert.deepEqual(resolveChatGptModel(model), { slug, effort, isPro }, model);
  }
});

test("ChatGPT Web Free Luna Think uses the captured reason system hint", () => {
  assert.deepEqual(resolveChatGptSystemHints("gpt-5.6-luna-free"), []);
  assert.deepEqual(resolveChatGptSystemHints("gpt-5.6-luna-free-thinking"), ["reason"]);
});
