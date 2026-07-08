/**
 * Anthropic server (built-in) tools must keep their literal `name` in EVERY
 * request section — tools[], message-history `tool_use` blocks, and
 * `tool_choice` — not just in the tools array.
 *
 * Anthropic's server tools are identified by a versioned `type`
 * (e.g. `web_search_20250305`) paired with a FIXED literal `name`
 * (`web_search`, `bash`, …) that the API validates as a pair. The tools-array
 * rewrite is already guarded by `isAnthropicServerToolType`, but the
 * message-history and `tool_choice` rewrites were not. That asymmetry renames
 * only the history/tool_choice reference (`web_search` → `WebSearch`) while
 * tools[] keeps the literal `web_search`, so Anthropic rejects the request:
 *
 *   [400] Tool 'WebSearch' not found in provided tools
 *
 * Same class for the fixed Claude Code rename map: `bash_20250124` carries the
 * literal name `bash`, which `remapToolNamesInRequest` would rewrite to `Bash`
 * (→ `tools.0.bash_20250124.name: Input should be 'bash'`).
 *
 * Regression surfaced on Claude Code 2.1.x native web-search calls; same class
 * as CLIProxyAPI #1094/#1179.
 *
 * Codex P2 follow-ups (PR #95):
 *  - request-specific tool map applied before generic reverse (no `Bash` →
 *    `bash` when the request map said `Bash` → `run_command`).
 *  - kill-switch returns the existing per-request map.
 *  - reverse map iterates longest-first (`Edit` must not shadow `MultiEdit`).
 *  - response remap restricts to JSON tool-name fields (no rewriting
 *    "Run Bash" assistant text to "Run bash").
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  cloakThirdPartyToolNames,
  remapToolNamesInRequest,
  remapToolNamesInResponse,
  isAnthropicServerToolType,
} from "../../open-sse/services/claudeCodeToolRemapper.js";

describe("cloakThirdPartyToolNames — server-tool names in message history", () => {
  it("keeps a history tool_use reference to a declared web_search server tool", () => {
    const body = {
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 8 }],
      messages: [
        {
          role: "assistant",
          content: [{ type: "tool_use", id: "toolu_1", name: "web_search", input: { query: "x" } }],
        },
      ],
    };
    cloakThirdPartyToolNames(body);
    expect(body.tools[0].name).toBe("web_search");
    const block = body.messages[0].content[0];
    expect(block.name).toBe("web_search");
  });

  it("keeps a tool_choice reference to a declared web_search server tool", () => {
    const body = {
      tools: [{ type: "web_search_20250305", name: "web_search" }],
      tool_choice: { type: "tool", name: "web_search" },
    };
    cloakThirdPartyToolNames(body);
    expect(body.tool_choice.name).toBe("web_search");
  });

  it("still cloaks a third-party history tool_use next to a server tool", () => {
    const body = {
      tools: [{ type: "web_search_20250305", name: "web_search" }, { name: "mixture_of_agents" }],
      messages: [
        {
          role: "assistant",
          content: [
            { type: "tool_use", id: "toolu_1", name: "web_search", input: {} },
            { type: "tool_use", id: "toolu_2", name: "mixture_of_agents", input: {} },
          ],
        },
      ],
    };
    cloakThirdPartyToolNames(body);
    const blocks = body.messages[0].content;
    expect(blocks[0].name).toBe("web_search");
    expect(blocks[1].name).toBe("MixtureOfAgents");
    expect(body.tools.map((t) => t.name)).toEqual(["web_search", "MixtureOfAgents"]);
  });

  it("still cloaks a snake_case history name when no server tool declares it", () => {
    const body = {
      tools: [{ name: "web_search", input_schema: { type: "object" } }],
      messages: [
        {
          role: "assistant",
          content: [{ type: "tool_use", id: "toolu_1", name: "web_search", input: {} }],
        },
      ],
    };
    cloakThirdPartyToolNames(body);
    expect(body.tools[0].name).toBe("WebSearch");
    const block = body.messages[0].content[0];
    expect(block.name).toBe("WebSearch");
  });
});

describe("remapToolNamesInRequest — Anthropic server tools", () => {
  it("does not rename a bash server tool to Bash in tools[]", () => {
    const body = { tools: [{ type: "bash_20250124", name: "bash" }] };
    remapToolNamesInRequest(body);
    expect(body.tools[0].name).toBe("bash");
    expect((body._toolNameMap?.size) ?? 0).toBe(0);
  });

  it("does not rename history/tool_choice references to a declared bash server tool", () => {
    const body = {
      tools: [{ type: "bash_20250124", name: "bash" }],
      messages: [
        {
          role: "assistant",
          content: [{ type: "tool_use", id: "toolu_1", name: "bash", input: { command: "ls" } }],
        },
      ],
      tool_choice: { type: "tool", name: "bash" },
    };
    remapToolNamesInRequest(body);
    const block = body.messages[0].content[0];
    expect(block.name).toBe("bash");
    expect(body.tool_choice.name).toBe("bash");
  });

  it("tolerates null entries in tools[] without throwing", () => {
    const body = {
      tools: [null, { type: "bash_20250124", name: "bash" }],
      messages: [
        {
          role: "assistant",
          content: [{ type: "tool_use", id: "toolu_1", name: "bash", input: {} }],
        },
      ],
    };
    remapToolNamesInRequest(body);
    expect(body.tools[1].name).toBe("bash");
    const block = body.messages[0].content[0];
    expect(block.name).toBe("bash");
  });

  it("still renames a plain lowercase custom bash tool to Bash", () => {
    const body = {
      tools: [{ name: "bash", input_schema: { type: "object" } }],
      messages: [
        {
          role: "assistant",
          content: [{ type: "tool_use", id: "toolu_1", name: "bash", input: {} }],
        },
      ],
    };
    remapToolNamesInRequest(body);
    expect(body.tools[0].name).toBe("Bash");
    const block = body.messages[0].content[0];
    expect(block.name).toBe("Bash");
  });
});

describe("remapToolNamesInResponse — Codex P2 follow-ups", () => {
  it("applies per-request tool map before generic reverse", () => {
    // Third-party client sent `run_command`; cloak mapped to `Bash` and
    // recorded `_toolNameMap.Bash -> run_command`. The response mentions
    // `Bash` (Anthropic's response). We must de-cloak back to `run_command`,
    // not generic `bash`.
    const perRequest = new Map([["Bash", "run_command"]]);
    const out = remapToolNamesInResponse(
      { content: [{ type: "tool_use", name: "Bash", input: {} }] },
      true,
      perRequest,
    );
    expect(out.content[0].name).toBe("run_command");
  });

  it("generic reverse still applies when per-request has no entry", () => {
    const out = remapToolNamesInResponse(
      { content: [{ type: "tool_use", name: "Bash", input: {} }] },
      true,
      new Map(),
    );
    expect(out.content[0].name).toBe("bash");
  });

  it("reverse iterates longest-first so Edit does not shadow MultiEdit", () => {
    // If we used REVERSE_MAP directly without sorting, processing "Edit"
    // would happen before "MultiEdit" and turn "MultiEdit" into "Multiedit".
    // Sorted longest-first processes "MultiEdit" -> "multiedit" first.
    const perRequest = new Map();
    const payload = { content: [{ type: "tool_use", name: "MultiEdit", input: {} }] };
    const out = remapToolNamesInResponse(payload, true, perRequest);
    expect(out.content[0].name).toBe("multiedit");
  });

  it("does not rewrite free-text assistant prose", () => {
    // Codex P2 #4: when the input is not JSON-parseable (free text from
    // an assistant message), we must not rewrite it at all.
    const text = "Run Bash in the morning to start the day";
    expect(remapToolNamesInResponse(text, true, new Map())).toBe(text);
  });

  it("returns the input untouched when not JSON-parseable", () => {
    const text = "no JSON here, just prose mentioning Bash";
    expect(remapToolNamesInResponse(text, true, new Map())).toBe(text);
  });

  it("lower-cases nested tool_name fields recursively", () => {
    const payload = {
      tool_calls: [
        { function: { name: "Bash", arguments: "{}" } },
        { function: { name: "Read", arguments: "{}" } },
      ],
    };
    const out = remapToolNamesInResponse(payload, true, new Map());
    expect(out.tool_calls[0].function.name).toBe("bash");
    expect(out.tool_calls[1].function.name).toBe("read");
  });
});

describe("cloakThirdPartyToolNames — kill switch returns existing map", () => {
  const originalEnv = process.env.CLAUDE_DISABLE_TOOL_NAME_CLOAK;
  beforeEach(() => {
    process.env.CLAUDE_DISABLE_TOOL_NAME_CLOAK = "true";
  });
  afterEach(() => {
    if (originalEnv === undefined) delete process.env.CLAUDE_DISABLE_TOOL_NAME_CLOAK;
    else process.env.CLAUDE_DISABLE_TOOL_NAME_CLOAK = originalEnv;
  });

  it("preserves an existing per-request tool name map when kill-switch is on", () => {
    const existing = new Map([["Bash", "run_command"]]);
    const body = {
      _toolNameMap: existing,
      tools: [{ name: "run_command" }],
      messages: [
        { role: "assistant", content: [{ type: "tool_use", name: "Bash", input: {} }] },
      ],
    };
    const returned = cloakThirdPartyToolNames(body);
    expect(returned).toBe(existing);
    // Body must NOT be mutated.
    expect(body.tools[0].name).toBe("run_command");
  });
});

describe("isAnthropicServerToolType", () => {
  it("matches versioned types", () => {
    expect(isAnthropicServerToolType("web_search_20250305")).toBe(true);
    expect(isAnthropicServerToolType("bash_20250124")).toBe(true);
  });
  it("matches non-versioned types", () => {
    expect(isAnthropicServerToolType("web_search")).toBe(true);
    expect(isAnthropicServerToolType("web_search_preview")).toBe(true);
  });
  it("rejects regular tools and non-strings", () => {
    expect(isAnthropicServerToolType("Bash")).toBe(false);
    expect(isAnthropicServerToolType("Read")).toBe(false);
    expect(isAnthropicServerToolType("")).toBe(false);
    expect(isAnthropicServerToolType(null)).toBe(false);
  });
});
