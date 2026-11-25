/**
 * OmniRoute #19341 — an explicit `tool_choice: "none"` is a prohibition, not a
 * tool selection: it forbids further tool calls and stays meaningful without
 * tool definitions, including a finalizer request whose conversation still
 * carries earlier assistant tool calls and tool results.
 *
 * The upstream fix kept `tool_choice: "none"` in two places:
 *   - `open-sse/services/targetRequestSanitizer.ts` (resolved-target sanitization)
 *   - `open-sse/translator/request/openai-responses.ts` (Responses→Chat conversion)
 *
 * DurinDoor has no `targetRequestSanitizer` module; its resolved-target guard is
 * `stripUnsupportedParams` (`open-sse/translator/concerns/paramSupport.js`) plus
 * the Chat-target normalization in `filterToOpenAIFormat`
 * (`open-sse/translator/formats/openai.js`). Both must leave an explicit "none"
 * untouched, and the Responses→Chat translator must not drop it either.
 *
 * These tests are offline: no network, no credentials, no provider traffic.
 */
import { describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";

import { FORMATS } from "../../open-sse/translator/formats.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { filterToOpenAIFormat } from "../../open-sse/translator/formats/openai.js";
import { enforceClaudeToolChoiceThinking } from "../../open-sse/translator/formats/claude.js";
import { stripUnsupportedParams } from "../../open-sse/translator/concerns/paramSupport.js";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
}));

const lookupTool = {
  type: "function",
  name: "lookup",
  description: "Look a synthetic record up.",
  parameters: { type: "object", properties: { id: { type: "string" } } },
};

const chatLookupTool = {
  type: "function",
  function: {
    name: "lookup",
    parameters: { type: "object", properties: { id: { type: "string" } } },
  },
};

/** Chat history of eight completed tool rounds, as a finalizer request replays it. */
function chatToolHistory(rounds = 8) {
  const messages = [{ role: "user", content: "Summarize the synthetic knowledge files." }];
  for (let round = 1; round <= rounds; round++) {
    const id = `call_finalizer_${round}`;
    messages.push(
      {
        role: "assistant",
        content: null,
        tool_calls: [{
          id,
          type: "function",
          function: { name: "lookup", arguments: '{"id":"synthetic"}' },
        }],
      },
      { role: "tool", tool_call_id: id, content: `Synthetic result ${round}.` },
    );
  }
  return messages;
}

/** The same history in Responses input-item form. */
function responsesToolHistory(rounds = 8) {
  const input = [{ type: "message", role: "user", content: [{ type: "input_text", text: "Summarize the synthetic knowledge files." }] }];
  for (let round = 1; round <= rounds; round++) {
    const callId = `call_finalizer_${round}`;
    input.push({
      type: "function_call",
      call_id: callId,
      name: "lookup",
      arguments: '{"id":"synthetic"}',
    });
    input.push({
      type: "function_call_output",
      call_id: callId,
      output: `Synthetic result ${round}.`,
    });
  }
  return input;
}

const TOOLS_CASES = [
  { label: "absent", tools: undefined },
  { label: "empty", tools: [] },
  { label: "declared", tools: [lookupTool] },
];

describe("explicit tool_choice none survives the Responses→Chat route", () => {
  for (const { label, tools } of TOOLS_CASES) {
    it(`preserves an explicit none with ${label} tool definitions`, () => {
      const body = {
        model: "m",
        input: "Give the final answer without more tools.",
        ...(tools === undefined ? {} : { tools }),
        tool_choice: "none",
        stream: true,
      };
      const snapshot = structuredClone(body);

      const out = translateRequest(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, "m", body, true);

      expect(out.tool_choice).toBe("none");
      expect(body).toEqual(snapshot);
    });
  }

  it("preserves an explicit none for a finalizer that replays tool history", () => {
    const body = {
      model: "m",
      input: responsesToolHistory(),
      tool_choice: "none",
      parallel_tool_calls: false,
      stream: true,
    };

    const out = translateRequest(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, "m", body, true);

    expect(out.tool_choice).toBe("none");
    expect(out.parallel_tool_calls).toBe(false);
    // The prohibition must not cost the conversation its earlier tool rounds.
    const toolMessages = out.messages.filter((message) => message.role === "tool");
    const assistantToolCalls = out.messages.filter((message) => message.role === "assistant" && message.tool_calls?.length);
    expect(toolMessages).toHaveLength(8);
    expect(assistantToolCalls).toHaveLength(8);
    expect(toolMessages[0].tool_call_id).toBe("call_finalizer_1");
    expect(toolMessages[7].tool_call_id).toBe("call_finalizer_8");
  });
});

describe("explicit tool_choice none survives an existing Chat route", () => {
  for (const { label, tools } of TOOLS_CASES) {
    it(`preserves an explicit none with ${label} tool definitions`, () => {
      const body = {
        model: "m",
        messages: [{ role: "user", content: "Give the final answer without more tools." }],
        ...(tools === undefined ? {} : { tools: tools === [] ? [] : [chatLookupTool] }),
        tool_choice: "none",
        parallel_tool_calls: false,
        stream: true,
      };

      const out = translateRequest(FORMATS.OPENAI, FORMATS.OPENAI, "m", body, true);

      expect(out.tool_choice).toBe("none");
      expect(out.parallel_tool_calls).toBe(false);
    });
  }

  it("preserves an explicit none for a finalizer that replays tool history", () => {
    const body = {
      model: "m",
      messages: chatToolHistory(),
      tool_choice: "none",
      parallel_tool_calls: false,
      stream: true,
    };

    const out = translateRequest(FORMATS.OPENAI, FORMATS.OPENAI, "m", body, true);

    expect(out.tool_choice).toBe("none");
    expect(out.parallel_tool_calls).toBe(false);
    expect(out.messages).toHaveLength(17);
    expect(out.messages.filter((message) => message.role === "tool")).toHaveLength(8);
    expect(out.messages.filter((message) => message.role === "assistant" && message.tool_calls?.length)).toHaveLength(8);
  });
});

describe("resolved-target sanitization keeps an explicit none", () => {
  for (const provider of ["openai", "openrouter", "openai-compatible-eu-fixture", "skhynix"]) {
    for (const { label, tools } of TOOLS_CASES) {
      it(`keeps an explicit none for ${provider} with ${label} tool definitions`, () => {
        const body = {
          messages: [{ role: "user", content: "Give the final answer without more tools." }],
          ...(tools === undefined ? {} : { tools: tools === [] ? [] : [chatLookupTool] }),
          tool_choice: "none",
          parallel_tool_calls: false,
          stream: true,
        };
        const snapshot = structuredClone(body);

        const out = stripUnsupportedParams(provider, "mistralai/mistral-medium-3-5", { ...body });

        expect(out.tool_choice).toBe("none");
        expect(out.parallel_tool_calls).toBe(false);
        expect(body).toEqual(snapshot);
      });
    }
  }

  it("keeps an explicit none while the Chat-target normalization drops empty definitions", () => {
    const body = {
      messages: [{ role: "user", content: "Give the final answer without more tools." }],
      tools: [],
      tool_choice: "none",
      stream: true,
    };

    const out = filterToOpenAIFormat(body);

    expect(out.tool_choice).toBe("none");
    expect(out.tools).toBeUndefined();
  });

  it("serializes the prohibition into the Chat wire body without inventing tools", () => {
    const body = {
      model: "m",
      messages: chatToolHistory(),
      tool_choice: "none",
      parallel_tool_calls: false,
      stream: true,
    };

    const translated = translateRequest(FORMATS.OPENAI, FORMATS.OPENAI, "m", body, true);
    const prepared = stripUnsupportedParams("openai-compatible-eu-fixture", "mistralai/mistral-medium-3-5", translated);
    const wire = JSON.parse(JSON.stringify(prepared));

    expect(wire.tool_choice).toBe("none");
    expect(wire.parallel_tool_calls).toBe(false);
    expect(wire.tools).toBeUndefined();
    expect(wire.messages.filter((message) => message.role === "tool")).toHaveLength(8);
  });
});

describe("unrelated tool_choice handling is unchanged", () => {
  it("leaves a missing tool_choice absent", () => {
    const body = { model: "m", input: "hello", stream: false };

    const out = translateRequest(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, "m", body, false);

    expect("tool_choice" in out).toBe(false);
  });

  it("keeps an automatic tool_choice as automatic", () => {
    const body = { model: "m", input: "hello", tool_choice: "auto", stream: false };

    const out = translateRequest(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, "m", body, false);

    expect(out.tool_choice).toBe("auto");
  });

  it("lowers a validated forced choice to the Chat shape", () => {
    const body = {
      model: "m",
      input: "hello",
      tools: [lookupTool],
      tool_choice: { type: "function", name: "lookup" },
      stream: false,
    };

    const out = translateRequest(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, "m", body, false);

    expect(out.tool_choice).toEqual({ type: "function", function: { name: "lookup" } });
  });

  it("still omits a required choice for a target that cannot express one", () => {
    const body = {
      model: "MiniMax-M3",
      messages: [{ role: "user", content: "hello" }],
      tools: [chatLookupTool],
      tool_choice: "required",
      stream: false,
    };

    const out = translateRequest(FORMATS.OPENAI, FORMATS.OPENAI, "MiniMax-M3", body, false, null, "minimax");

    expect(out.tool_choice).toBe("auto");
  });

  it("still omits a forced choice for a target that rejects it", () => {
    const body = {
      tool_choice: { type: "any" },
      thinking: { type: "enabled", budget_tokens: 1024 },
    };

    enforceClaudeToolChoiceThinking(body, "claude-opus-5", "claude");

    expect(body.tool_choice).toEqual({ type: "auto" });
  });

  it("keeps an explicit none for a target that rejects forced choices", () => {
    const body = {
      tool_choice: { type: "none" },
      thinking: { type: "enabled", budget_tokens: 1024 },
    };

    enforceClaudeToolChoiceThinking(body, "claude-opus-5", "claude");

    expect(body.tool_choice).toEqual({ type: "none" });
  });
});
