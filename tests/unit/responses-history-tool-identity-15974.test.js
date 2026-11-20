// G-a2-2 / OmniRoute #15974: recover namespaced Responses tool identities from
// the request's own function-call history.
//
// A follow-up turn that continues a conversation (`previous_response_id`) or
// simply omits `tools` sends only the `input` history. The history items still
// carry the `{namespace, name}` identity of every earlier call, so the
// response translator must restore the namespace instead of forwarding the
// dotted wire name flat.
import { describe, expect, it } from "vitest";
import "../translator/registerAll.js";
import { translateResponse, initState } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import {
  collectHistoricalToolIdentities,
  mergeHistoricalToolIdentities,
} from "../../open-sse/translator/response/openai-responses/historyToolIdentity.js";

const namespaceTool = (name, tools) => ({ type: "namespace", name, tools });

const historyCall = (namespace, name, callId = "old_call") => ({
  type: "function_call",
  call_id: callId,
  namespace,
  name,
  arguments: "{}",
});

function functionCallItems(requestBody, wireName) {
  const state = initState(FORMATS.OPENAI_RESPONSES, requestBody);
  const chunks = [
    {
      choices: [{
        index: 0,
        delta: { tool_calls: [{ index: 0, id: "new_call", type: "function", function: { name: wireName, arguments: "{}" } }] },
        finish_reason: null,
      }],
    },
    { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
  ];
  const events = chunks.flatMap((chunk) =>
    translateResponse(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, chunk, state));
  return events
    .filter((e) => e.event === "response.output_item.added" || e.event === "response.output_item.done")
    .map((e) => e.data.item)
    .filter((item) => item?.type === "function_call");
}

describe("Responses history tool identity (OmniRoute #15974)", () => {
  it("restores the namespace from history when the request declares no tools", () => {
    const items = functionCallItems(
      { input: [historyCall("collaboration", "spawn_agent")] },
      "collaboration.spawn_agent",
    );

    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.namespace).toBe("collaboration");
      expect(item.name).toBe("spawn_agent");
    }
  });

  it("restores the namespace when the request continues with previous_response_id", () => {
    const items = functionCallItems(
      {
        input: [historyCall("orchestration", "run_step", "old_1")],
        previous_response_id: "resp_previous",
      },
      "orchestration.run_step",
    );

    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.namespace).toBe("orchestration");
      expect(item.name).toBe("run_step");
    }
  });

  it("keeps a current namespace declaration ahead of the history", () => {
    const items = functionCallItems(
      {
        input: [historyCall("collaboration", "spawn_agent")],
        tools: [namespaceTool("orchestration", [{ name: "spawn_agent" }])],
      },
      "orchestration.spawn_agent",
    );

    for (const item of items) {
      expect(item.namespace).toBe("orchestration");
      expect(item.name).toBe("spawn_agent");
    }
  });

  it("does not give a flat declaration a historical namespace", () => {
    const items = functionCallItems(
      {
        input: [historyCall("collaboration", "spawn_agent")],
        tools: [{ type: "function", name: "collaboration.spawn_agent", parameters: { type: "object" } }],
      },
      "collaboration.spawn_agent",
    );

    for (const item of items) {
      expect(item.name).toBe("collaboration.spawn_agent");
      expect("namespace" in item).toBe(false);
    }
  });

  it("never guesses a namespace when the history is ambiguous", () => {
    const items = functionCallItems(
      {
        input: [
          historyCall("mcp__a", "mcp__ambiguous__read", "old_0"),
          historyCall("mcp__b", "mcp__ambiguous__read", "old_1"),
        ],
      },
      "mcp__ambiguous__read",
    );

    for (const item of items) {
      expect(item.name).toBe("mcp__ambiguous__read");
      expect("namespace" in item).toBe(false);
    }
  });

  it("keeps repeated identical history unambiguous", () => {
    const items = functionCallItems(
      {
        input: [
          historyCall("collaboration", "spawn_agent", "old_1"),
          historyCall("collaboration", "spawn_agent", "old_2"),
        ],
      },
      "collaboration.spawn_agent",
    );

    for (const item of items) {
      expect(item.namespace).toBe("collaboration");
      expect(item.name).toBe("spawn_agent");
    }
  });

  it("ignores invalid and namespace-free history", () => {
    expect(collectHistoricalToolIdentities([
      { type: "function_call", call_id: "", namespace: "collaboration", name: "spawn_agent" },
      { type: "function_call", call_id: "c1", namespace: "collaboration", name: "" },
      { type: "function_call", call_id: "c2", namespace: "", name: "flat" },
      { type: "message", role: "user", content: "hi" },
    ]).size).toBe(0);
  });

  it("does not let a later request inherit another request's history", () => {
    const first = initState(FORMATS.OPENAI_RESPONSES, {
      input: [historyCall("collaboration", "spawn_agent")],
    });
    expect(first.toolNamespaces["collaboration.spawn_agent"]).toBe("collaboration");

    const second = initState(FORMATS.OPENAI_RESPONSES, { input: [] });
    expect(second.toolNamespaces["collaboration.spawn_agent"]).toBeUndefined();
  });

  it("merges history into the current map without overwriting it", () => {
    const current = { "orchestration.run_step": "orchestration" };
    mergeHistoricalToolIdentities(current, [
      historyCall("collaboration", "spawn_agent"),
      historyCall("orchestration", "run_step"),
    ]);

    expect(current["orchestration.run_step"]).toBe("orchestration");
    expect(current["collaboration.spawn_agent"]).toBe("collaboration");
  });
});
