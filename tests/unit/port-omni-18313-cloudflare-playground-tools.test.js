/**
 * OmniRoute #18313 — emulated tool calling for the Cloudflare AI Playground.
 * The real executor runs against an in-memory transport; nothing is dialed.
 */
import { describe, expect, it } from "vitest";
import { CloudflarePlaygroundExecutor } from "../../open-sse/executors/cloudflare-playground.js";

const TOOLS = [
  { type: "function", function: { name: "read", description: "Read a file", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false } } },
  { type: "function", function: { name: "run_shell", parameters: { type: "object", properties: { command: { type: "string" }, timeout: { type: "integer" } }, required: ["command"] } } },
];
const USER = [{ role: "user", content: "show me package.json" }];
const nonceOf = (messages) => /"_nonce": "([a-z0-9]+)"/.exec(messages[0].parts[0].text)?.[1];
const wireText = (messages) => messages.map((message) => message.parts[0].text);

/** Runs one request; `reply` is the model's text, or a function of the request nonce. */
async function run({ reply = "ok", messages = USER, tools = TOOLS, stream = false, done = true, errorFrame = null, ...extra } = {}) {
  const world = { sent: null };
  const executor = new CloudflarePlaygroundExecutor((id) => ({
    async start(config) { world.sent = config.messages; return { ok: true }; },
    async *frames() {
      const text = reply instanceof Function ? reply(nonceOf(world.sent)) : reply;
      const frame = (body, rest = {}) => JSON.stringify({ id, type: "cf_agent_use_chat_response", body: JSON.stringify(body), ...rest });
      // Split the reply so a call envelope always spans several deltas.
      for (const delta of text.match(/[\s\S]{1,7}/g) ?? []) yield frame({ type: "text-delta", delta });
      if (errorFrame) yield frame({ message: errorFrame }, { error: true });
      else if (done) yield frame({}, { done: true });
    },
    async close() {},
  }));
  const body = { model: "zai-org/glm-5.2", messages, ...(tools ? { tools } : null), ...extra };
  const { response } = await executor.execute({ model: body.model, body, stream, credentials: {}, proxyOptions: { disableEnvProxy: true } });
  const text = await response.text();
  const events = stream
    ? text.split("\n\n").filter((line) => line.startsWith("data: {")).map((line) => JSON.parse(line.slice(6)))
    : null;
  return { status: response.status, text, events, json: stream ? null : JSON.parse(text), sent: world.sent };
}

const envelope = (name, args, nonce, extra = {}) =>
  JSON.stringify({ type: "tool_call", name, arguments: args, _nonce: nonce, ...extra });
const choiceOf = (result) => result.json.choices[0];
const callsOf = (result) => choiceOf(result).message.tool_calls?.map((call) => [call.function.name, JSON.parse(call.function.arguments)]);

describe("OmniRoute #18313 tool request", () => {
  it("sends the tool contract as its own user message ahead of the conversation", async () => {
    const { sent } = await run({ messages: [{ role: "system", content: "dropped by the playground" }, ...USER] });
    expect(sent.map((message) => message.role)).toEqual(["user", "user"]);
    const [contract, user] = wireText(sent);
    expect(contract).toContain("- read({path: string})");
    expect(contract).toContain("- run_shell({command: string, timeout?: integer})");
    expect(contract).toContain("Read a file");
    expect(nonceOf(sent)).toMatch(/^[a-z0-9]{8}$/);
    expect(user).toBe("show me package.json");
  });

  it("binds each request to its own nonce", async () => {
    expect(nonceOf((await run()).sent)).not.toBe(nonceOf((await run()).sent));
  });

  it.each([
    ["no tools", { tools: null }],
    ["tool_choice none", { tool_choice: "none" }],
  ])("leaves a text-only request untouched with %s", async (_label, options) => {
    const reply = '{"name":"read","arguments":{"path":"a"}}';
    const result = await run({ reply, ...options });
    expect(wireText(result.sent)).toEqual(["show me package.json"]);
    expect(choiceOf(result)).toMatchObject({ finish_reason: "stop", message: { content: reply } });
  });

  it("offers only the tool a forced tool_choice names", async () => {
    const result = await run({
      tool_choice: { type: "function", function: { name: "read" } },
      reply: (nonce) => envelope("run_shell", { command: "ls" }, nonce),
    });
    expect(wireText(result.sent)[0]).not.toContain("run_shell");
    expect(wireText(result.sent)[0]).toContain("You must call a tool");
    expect(callsOf(result)).toBeUndefined();
  });
});

describe("OmniRoute #18313 tool-call replies", () => {
  it.each([
    ["the contract envelope", (n) => envelope("read", { path: "a.json" }, n)],
    ["an envelope without type or nonce", () => '{"name":"read","arguments":{"path":"a.json"}}'],
    ["a fenced envelope", (n) => "```json\n" + envelope("read", { path: "a.json" }, n) + "\n```"],
    ["arguments serialized as a string", () => JSON.stringify({ name: "read", arguments: '{"path":"a.json"}' })],
    ["the OpenAI tool_calls wrapper", () => JSON.stringify({ tool_calls: [{ type: "function", function: { name: "read", arguments: { path: "a.json" } } }] })],
    ["a <tool> block", () => '<tool>{"name":"read","arguments":{"path":"a.json"}}</tool>'],
    ["a <tool_call> block", () => '<tool_call>{"name":"read","arguments":{"path":"a.json"}}</tool_call>'],
  ])("reads %s", async (_label, reply) => {
    const result = await run({ reply });
    expect(choiceOf(result)).toMatchObject({ finish_reason: "tool_calls", message: { role: "assistant", content: null } });
    expect(callsOf(result)).toEqual([["read", { path: "a.json" }]]);
  });

  it("is not misled by an unbalanced brace in the prose before a bound call", async () => {
    const result = await run({ reply: (n) => `A block opens with { in C.\n${envelope("read", { path: "a" }, n)}` });
    expect(callsOf(result)).toEqual([["read", { path: "a" }]]);
  });

  it("completes a tool reply whose closing frame has no JSON body", async () => {
    const executor = new CloudflarePlaygroundExecutor((id) => ({
      async start() { return { ok: true }; },
      async *frames() {
        const reply = '{"name":"read","arguments":{"path":"a"}}';
        yield JSON.stringify({ id, type: "cf_agent_use_chat_response", body: JSON.stringify({ type: "text-delta", delta: reply }) });
        yield JSON.stringify({ id, type: "cf_agent_use_chat_response", done: true, body: "" });
      },
      async close() {},
    }));
    const { response } = await executor.execute({ model: "m", body: { messages: USER, tools: TOOLS }, stream: false, credentials: {} });
    expect((await response.json()).choices[0].finish_reason).toBe("tool_calls");
  });

  it("keeps the prose around an embedded call bound to this request", async () => {
    const result = await run({ reply: (n) => `Reading it now.\n${envelope("read", { path: "a.json" }, n)}` });
    expect(callsOf(result)).toEqual([["read", { path: "a.json" }]]);
    expect(choiceOf(result).message.content).toBe("Reading it now.");
  });

  it("matches a declared name that differs only in case and separators", async () => {
    const result = await run({ reply: (n) => envelope("RunShell", { command: "ls" }, n) });
    expect(callsOf(result)).toEqual([["run_shell", { command: "ls" }]]);
  });

  it("streams parallel calls as one delta each, with an index and its own id", async () => {
    const result = await run({ stream: true, reply: (n) => `[${envelope("read", { path: "a" }, n)}, ${envelope("read", { path: "b" }, n)}]` });
    const deltas = result.events.flatMap((event) => event.choices[0].delta.tool_calls ?? []);
    expect(deltas.map((call) => [call.index, call.function.name, call.function.arguments])).toEqual([
      [0, "read", '{"path":"a"}'], [1, "read", '{"path":"b"}'],
    ]);
    expect(new Set(deltas.map((call) => call.id)).size).toBe(2);
    expect(result.events.some((event) => event.choices[0].delta.content?.includes("path"))).toBe(false);
    expect(result.events.at(-1).choices[0].finish_reason).toBe("tool_calls");
    expect(result.text.trim().endsWith("data: [DONE]")).toBe(true);
  });

  it("streams a plain answer with a stop finish reason when tools are declared", async () => {
    const result = await run({ stream: true, reply: "No tool needed here." });
    expect(result.events.map((event) => event.choices[0].delta.content ?? "").join("")).toBe("No tool needed here.");
    expect(result.events.at(-1).choices[0].finish_reason).toBe("stop");
  });
});

describe("OmniRoute #18313 malformed arguments and untrusted envelopes", () => {
  const cases = [
    ["a wrong argument type", (n) => envelope("run_shell", { command: "ls", timeout: "soon" }, n)],
    ["a missing required argument", (n) => envelope("read", {}, n)],
    ["an undeclared argument on a closed schema", (n) => envelope("read", { path: "a", mode: "w" }, n)],
    ["arguments that are not an object", (n) => envelope("read", ["a"], n)],
    ["arguments that are broken JSON", (n) => envelope("read", '{"path":', n)],
    ["an undeclared tool", (n) => envelope("delete_all", { path: "a" }, n)],
    ["a nonce from another request", () => envelope("read", { path: "a" }, "stale000")],
    ["a type that is not tool_call", (n) => envelope("read", { path: "a" }, n, { type: "function" })],
    ["one bad call in a batch", (n) => `[${envelope("read", { path: "a" }, n)}, ${envelope("read", {}, n)}]`],
    ["a batch cut off mid-array", (n) => `[${envelope("read", { path: "a" }, n)}, {"name": "read", "argu`],
    ["a second call cut off", (n) => `${envelope("read", { path: "a" }, n)}\n{"name": "read", "argu`],
    ["prose quoting an unbound envelope", () => 'The format is {"name":"read","arguments":{"path":"a"}} as shown.'],
    ["quoted config JSON", () => '{"name":"durindoor","version":"1.0.0"}'],
    ["a broken batch that holds one complete call", (n) => `Calls: [${envelope("read", { path: "a" }, n)}, {"name": "read", "arguments": {oops}}]`],
    ["a tagged call beside an untagged attempt", (n) => `<tool>{"name":"read","arguments":{"path":"a"}}</tool> ${envelope("read", {}, n)}`],
    ["an unterminated tool tag", () => '<tool>{"name":"read","arguments":{"path":"a"}}'],
  ];

  it.each(cases)("returns %s as text and never executes it", async (_label, reply) => {
    for (const stream of [false, true]) {
      let raw;
      const result = await run({ stream, reply: (n) => (raw = reply(n)) });
      if (stream) {
        expect(result.events.some((event) => event.choices[0].delta.tool_calls)).toBe(false);
        expect(result.events.map((event) => event.choices[0].delta.content ?? "").join("")).toBe(raw);
        expect(result.events.at(-1).choices[0].finish_reason).toBe("stop");
      } else {
        expect(choiceOf(result)).toMatchObject({ finish_reason: "stop", message: { content: raw } });
        expect(callsOf(result)).toBeUndefined();
      }
    }
  });

  it("does not execute a call from a reply that never completed", async () => {
    const reply = (n) => envelope("read", { path: "a" }, n);
    const plain = await run({ reply, done: false });
    expect(plain.status).toBe(502);
    const streamed = await run({ reply, done: false, stream: true });
    expect(streamed.text).not.toContain('"tool_calls"');
    expect(streamed.events.at(-1).error.code).toBe("HTTP_502");
  });

  it("does not execute a call that arrived beside an upstream error", async () => {
    const reply = (n) => envelope("read", { path: "a" }, n);
    expect((await run({ reply, errorFrame: "rate limit reached" })).status).toBe(429);
    const streamed = await run({ reply, errorFrame: "rate limit reached", stream: true });
    expect(streamed.text).not.toContain('"tool_calls"');
    expect(streamed.events.at(-1).error.code).toBe("HTTP_429");
  });
});

describe("OmniRoute #18313 history replay and playground limits", () => {
  const turn = (i, size = 10) => [
    { role: "assistant", content: null, tool_calls: [{ id: `call_${i}`, type: "function", function: { name: "read", arguments: `{"path":"f${i}"}` } }] },
    { role: "tool", tool_call_id: `call_${i}`, content: `result ${i} ${"x".repeat(size)}` },
  ];

  it("replays assistant tool calls and tool results as text", async () => {
    const { sent } = await run({ messages: [...USER, ...turn(1)] });
    expect(sent.map((message) => message.role)).toEqual(["user", "user", "assistant", "user"]);
    expect(JSON.parse(wireText(sent)[2])).toEqual({ type: "tool_call", name: "read", arguments: { path: "f1" } });
    expect(JSON.parse(wireText(sent)[3])).toEqual({ tool_result: { call_id: "call_1", content: "result 1 xxxxxxxxxx" } });
  });

  it("keeps the replay when the follow-up request declares no tools", async () => {
    const { sent } = await run({ tools: null, messages: [...USER, ...turn(1)] });
    expect(wireText(sent)).toHaveLength(3);
    expect(wireText(sent)[2]).toContain("tool_result");
  });

  it("fits a long agent loop inside both caps, keeping the task and the newest turn", async () => {
    const messages = [{ role: "user", content: "ORIGINAL TASK: audit the repo" },
      ...Array.from({ length: 30 }, (_, i) => turn(i, 9000)).flat()];
    const texts = wireText((await run({ messages })).sent);
    const { sent } = await run({ messages });
    expect(sent.filter((message) => message.role === "user").length).toBeLessThanOrEqual(10);
    expect(Math.max(...texts.map((text) => text.length))).toBeLessThanOrEqual(5800);
    expect(texts[1]).toContain("Earlier conversation (compacted");
    expect(texts[1]).toContain("ORIGINAL TASK: audit the repo");
    expect(texts[1]).toContain("elided");
    expect(texts.at(-1)).toContain("result 29 ");
    expect(texts.at(-1)).toContain("truncated");
  });

  it("chunks a large toolset and still leaves room for the conversation", async () => {
    const tools = Array.from({ length: 900 }, (_, i) => ({ type: "function", function: {
      name: `tool_${i}`, parameters: { type: "object", properties: { alpha: { type: "string" }, beta: { type: "number" } } } } }));
    const messages = [...USER, ...Array.from({ length: 12 }, (_, i) => turn(i)).flat()];
    const { sent } = await run({ tools, messages });
    expect(sent.filter((message) => message.role === "user").length).toBeLessThanOrEqual(10);
    expect(Math.max(...wireText(sent).map((text) => text.length))).toBeLessThanOrEqual(5800);
    expect(wireText(sent)[0]).toContain("tool_0(");
    expect(wireText(sent).at(-1)).toContain("result 11 ");
  });
});
