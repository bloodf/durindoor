import { describe, expect, it } from "vitest";
import { cloakClaudeTools } from "../../open-sse/utils/claudeCloaking.js";

describe("cloakClaudeTools preserves Anthropic server tool literal names", () => {
  it("keeps message history and tool_choice references to declared server tools", () => {
    const body = {
      tools: [
        { type: "web_search_20250305", name: "web_search", max_uses: 8 },
        { name: "mixture_of_agents" },
      ],
      messages: [
        {
          role: "assistant",
          content: [
            { type: "tool_use", id: "toolu_1", name: "web_search", input: { query: "x" } },
            { type: "tool_use", id: "toolu_2", name: "mixture_of_agents", input: {} },
          ],
        },
      ],
      tool_choice: { type: "tool", name: "mixture_of_agents" },
    };

    const { body: cloaked } = cloakClaudeTools(body);

    const tools = cloaked.tools;
    expect(tools[0].name).toBe("web_search");
    expect(tools[1].name).toBe("mixture_of_agents_ide");

    const blocks = cloaked.messages[0].content;
    expect(blocks[0].name).toBe("web_search");
    expect(blocks[1].name).toBe("mixture_of_agents_ide");

    expect(cloaked.tool_choice.name).toBe("mixture_of_agents_ide");
  });

  it("does not rewrite tool_choice for a server tool", () => {
    const body = {
      tools: [{ type: "web_search_20250305", name: "web_search" }],
      tool_choice: { type: "tool", name: "web_search" },
    };

    const { body: cloaked } = cloakClaudeTools(body);

    expect(cloaked.tools[0].name).toBe("web_search");
    expect(cloaked.tool_choice.name).toBe("web_search");
  });
});

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
 * Ported from OmniRoute #6586. The remapper is shipped as `claudeCodeToolRemapper.js`
 * in the OmniRoute upstream; DurinDoor keeps the .ts source verbatim (no TS toolchain
 * in CI yet), so vitest must transform it on import. We import the .ts file directly
 * via vitest's built-in ESBuild transformer — that is what this config's `defineConfig`
 * defaults allow.
 */
import {
  cloakThirdPartyToolNames,
  remapToolNamesInRequest,
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
