import { describe, expect, it } from "vitest";
import { CodexExecutor } from "../../open-sse/executors/codex.js";
import { OpenCodeGoExecutor } from "../../open-sse/executors/opencode-go.js";
import { GrokCliExecutor } from "../../open-sse/executors/grok-cli.js";
import { ROLE, RESPONSES_ITEM } from "../../open-sse/translator/schema/index.js";

const history = [
  { type: RESPONSES_ITEM.MESSAGE, role: ROLE.USER, content: [{ type: RESPONSES_ITEM.INPUT_TEXT, text: "Earlier question" }] },
  { type: RESPONSES_ITEM.MESSAGE, role: ROLE.ASSISTANT, content: [{ type: RESPONSES_ITEM.OUTPUT_TEXT, text: "Earlier answer" }] },
];

// Exercise the actual native wire boundary: translator identity skips these executors.
describe.each([
  ["Codex", CodexExecutor, "gpt-5.5"],
  ["OpenCode Go", OpenCodeGoExecutor, "muse-spark-1.3-contributor-free"],
  ["Grok CLI", GrokCliExecutor, "grok-build"],
])("%s native agent input", (_name, Executor, model) => {
  it.each([
    { type: RESPONSES_ITEM.AGENT_MESSAGE },
    { role: RESPONSES_ITEM.AGENT_MESSAGE },
    { type: RESPONSES_ITEM.MESSAGE, role: RESPONSES_ITEM.AGENT_MESSAGE },
    { type: RESPONSES_ITEM.AGENT_MESSAGE, role: ROLE.ASSISTANT },
  ])("preserves plaintext and encrypted content with discriminator %j", (discriminator) => {
    const items = [
      { ...discriminator, author: "parent", recipient: "worker", content: "Native task" },
      { ...discriminator, author: "worker", recipient: "parent", content: [{ type: "encrypted_content", encrypted_content: "opaque-agent-payload" }] },
    ];
    const input = [...history, ...items];
    const body = { model, input: structuredClone(input) };
    const result = new Executor().transformRequest(model, body, true, { providerSpecificData: {} });
    // Codex already canonicalizes role-based messages, including text wrapping.
    // Preserve that native contract while requiring agent identity and payloads.
    const expected = structuredClone(input);
    if (Executor === CodexExecutor && discriminator.type !== RESPONSES_ITEM.AGENT_MESSAGE) {
      expected[2].type = RESPONSES_ITEM.MESSAGE;
      expected[2].content = [{ type: RESPONSES_ITEM.INPUT_TEXT, text: "Native task" }];
      expected[3].type = RESPONSES_ITEM.MESSAGE;
    }
    expect(result.input).toEqual(expected);
  });
});
