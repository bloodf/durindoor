import { beforeEach, describe, expect, it, vi } from "vitest";
import { GrokCliExecutor, _resetGrokCliTurnStore } from "../../open-sse/executors/grok-cli.js";

// Upstream OmniRoute#14596: Codex CLI declares every MCP server (and its own
// multi-agent tools) as a Responses `type:"namespace"` tool group. Responses
// clients reach grok-cli on the same-format lane (no request translation runs),
// so Grok Build's cli-chat-proxy sees the raw `namespace` tool and rejects the
// whole request:
//   422 tools[N].type: unknown variant `namespace`, expected one of `function`, ...
// GrokCliExecutor.execute() must flatten namespace tool groups into function
// tools before dispatch, rename matching `function_call` history items, and
// restore the `{namespace, name}` identity on any function call Grok Build
// returns so Codex can dispatch it.

function normalSseResponse(events) {
  const text = events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
  return new Response(text, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

function parseSse(text) {
  return text
    .split(/\n\n/)
    .map((block) => block.split("\n").find((line) => line.startsWith("data:")))
    .filter(Boolean)
    .map((line) => JSON.parse(line.slice(5).trim()));
}

// `vi.hoisted` so `proxyAwareFetch` exists before the (hoisted) `vi.mock` factory
// runs, even though this file's static executor import resolves the real
// proxyFetch.js module during initial module-graph load.
const { proxyAwareFetch } = vi.hoisted(() => ({ proxyAwareFetch: vi.fn() }));

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch,
}));

function codexBody() {
  return {
    model: "grok-build",
    stream: true,
    input: [
      { type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] },
      {
        type: "function_call",
        call_id: "call_prev",
        namespace: "mcp__notion",
        name: "API_get_self",
        arguments: "{}",
      },
      { type: "function_call_output", call_id: "call_prev", output: "{}" },
    ],
    tools: [
      { type: "web_search" },
      { type: "function", name: "exec_command", parameters: { type: "object" } },
      {
        type: "namespace",
        name: "mcp__notion",
        description: "Notion MCP",
        tools: [
          { type: "function", name: "API_get_self", description: "who am i", parameters: { type: "object", properties: {} } },
          { type: "function", name: "API_post_search", parameters: { type: "object" } },
        ],
      },
      {
        type: "namespace",
        name: "multi_agent_v1",
        tools: [{ type: "function", name: "spawn_agent", parameters: { type: "object" } }],
      },
    ],
  };
}

describe("grok-cli Responses namespace tool flattening (omniroute-14596)", () => {
  beforeEach(() => {
    proxyAwareFetch.mockReset();
  });

  async function runExecute(body, upstream) {
    _resetGrokCliTurnStore();
    proxyAwareFetch.mockImplementation(async (_url, init) => {
      proxyAwareFetch.lastBody = JSON.parse(init.body);
      return upstream();
    });
    const executor = new GrokCliExecutor();
    const result = await executor.execute({
      model: "grok-build",
      body,
      stream: true,
      credentials: { accessToken: "grok-token" },
    });
    return { response: result.response, sentBody: proxyAwareFetch.lastBody };
  }

  it("flattens namespace tool groups into function tools and renames prior namespaced history", async () => {
    const { sentBody } = await runExecute(codexBody(), () => normalSseResponse([{ type: "response.completed" }]));

    expect(sentBody.tools.every((tool) => tool.type !== "namespace")).toBe(true);
    expect(sentBody.tools.map((tool) => `${tool.type}:${tool.name ?? ""}`)).toEqual([
      "web_search:",
      "function:exec_command",
      "function:mcp__notion.API_get_self",
      "function:mcp__notion.API_post_search",
      "function:multi_agent_v1.spawn_agent",
    ]);
    const notionSelf = sentBody.tools[2];
    expect(notionSelf.description).toBe("who am i");
    expect(notionSelf.parameters).toEqual({ type: "object", properties: {} });

    const priorCall = sentBody.input.find((item) => item.type === "function_call");
    expect(priorCall.name).toBe("mcp__notion.API_get_self");
    expect("namespace" in priorCall).toBe(false);
  });

  it("restores namespace identity on streamed function calls", async () => {
    const flatCall = { type: "function_call", id: "fc_1", call_id: "call_1", name: "mcp__notion.API_post_search", arguments: "" };
    const agentCall = { type: "function_call", id: "fc_2", call_id: "call_2", name: "multi_agent_v1.spawn_agent", arguments: "{}" };
    const { response } = await runExecute(codexBody(), () =>
      normalSseResponse([
        { type: "response.output_item.added", output_index: 0, item: flatCall },
        { type: "response.output_item.done", output_index: 0, item: { ...flatCall, arguments: '{"q":"x"}' } },
        { type: "response.output_item.done", output_index: 1, item: agentCall },
        { type: "response.completed", response: { output: [{ ...flatCall, arguments: '{"q":"x"}' }, agentCall] } },
      ]),
    );

    const events = parseSse(await response.text());
    expect(events[0].item.namespace).toBe("mcp__notion");
    expect(events[0].item.name).toBe("API_post_search");
    expect(events[1].item.namespace).toBe("mcp__notion");
    expect(events[1].item.name).toBe("API_post_search");
    expect(events[1].item.arguments).toBe('{"q":"x"}');
    expect(events[2].item.namespace).toBe("multi_agent_v1");
    expect(events[2].item.name).toBe("spawn_agent");
    expect(events[3].response.output.map((item) => `${item.namespace}/${item.name}`)).toEqual([
      "mcp__notion/API_post_search",
      "multi_agent_v1/spawn_agent",
    ]);
  });

  it("restores namespace identity on non-streaming Responses JSON", async () => {
    const { response } = await runExecute(codexBody(), () =>
      new Response(
        JSON.stringify({
          id: "resp_1",
          object: "response",
          output: [{ type: "function_call", call_id: "call_1", name: "mcp__notion.API_get_self", arguments: "{}" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const json = await response.json();
    expect(json.output[0].namespace).toBe("mcp__notion");
    expect(json.output[0].name).toBe("API_get_self");
  });

  it("leaves requests without namespace tools and their responses untouched", async () => {
    const body = {
      model: "grok-build",
      input: "hi",
      tools: [{ type: "function", name: "exec_command", parameters: { type: "object" } }],
    };
    const { response, sentBody } = await runExecute(body, () =>
      normalSseResponse([{ type: "response.output_item.done", item: { type: "function_call", call_id: "c", name: "exec_command", arguments: "{}" } }]),
    );

    expect(sentBody.tools.map((tool) => tool.name)).toEqual(["exec_command"]);
    const events = parseSse(await response.text());
    expect(events[0].item.name).toBe("exec_command");
    expect("namespace" in events[0].item).toBe(false);
  });

  it("drops non-function namespace children instead of faking them", async () => {
    const body = codexBody();
    body.tools.push({
      type: "namespace",
      name: "mcp__edit",
      tools: [
        { type: "custom", name: "apply_patch", format: { type: "grammar" } },
        { type: "function", name: "read", parameters: { type: "object" } },
      ],
    });
    const { sentBody } = await runExecute(body, () => normalSseResponse([{ type: "response.completed" }]));

    const names = sentBody.tools.map((tool) => tool.name);
    expect(names).toContain("mcp__edit.read");
    expect(names.some((name) => String(name).includes("apply_patch"))).toBe(false);
  });

  it("flattens namespaced history even when the turn declares no namespace tools", async () => {
    const body = codexBody();
    body.tools = [{ type: "function", name: "exec_command", parameters: { type: "object" } }];
    const { sentBody } = await runExecute(body, () => normalSseResponse([{ type: "response.completed" }]));

    const priorCall = sentBody.input.find((item) => item.type === "function_call");
    expect(priorCall.name).toBe("mcp__notion.API_get_self");
    expect("namespace" in priorCall).toBe(false);
  });

  it("warns when flattened namespace tools exceed the 200-tool Grok Build cap", async () => {
    const body = codexBody();
    body.tools.push({
      type: "namespace",
      name: "mcp__big",
      tools: Array.from({ length: 250 }, (_, i) => ({ type: "function", name: `tool${i}`, parameters: { type: "object" } })),
    });
    const warn = vi.fn();
    _resetGrokCliTurnStore();
    proxyAwareFetch.mockImplementation(async (_url, init) => {
      proxyAwareFetch.lastBody = JSON.parse(init.body);
      return normalSseResponse([{ type: "response.completed" }]);
    });
    const executor = new GrokCliExecutor();
    await executor.execute({
      model: "grok-build",
      body,
      stream: true,
      credentials: { accessToken: "grok-token" },
      log: { warn },
    });

    expect(warn).toHaveBeenCalled();
    expect(proxyAwareFetch.lastBody.tools.length).toBe(200);
  });
});
