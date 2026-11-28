// Issue 2254: emptyStreamGuard and the stream transform read the same events as sseFrames.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { createEmptyRetryStream } from "../../open-sse/handlers/chatCore/emptyStreamGuard.js";
import { createSSEStream } from "../../open-sse/utils/stream.js";
import { createSseFrameReader } from "../../open-sse/utils/sseFrames.js";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
}));

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const gemini = (text, finishReason) => ({
  candidates: [{ index: 0, content: { role: "model", parts: [{ text }] }, ...(finishReason ? { finishReason } : null) }],
});
const chat = (text, finishReason) => ({
  id: "chatcmpl-frames",
  object: "chat.completion.chunk",
  created: 1,
  model: "m",
  choices: [{ index: 0, delta: { content: text }, finish_reason: finishReason ? "stop" : null }],
});

const one = (event) => [JSON.stringify(event)];
const pretty = (event) => JSON.stringify(event, null, 2).split("\n");
// Splits so that one continuation line is itself a complete JSON object.
const split = (event) => {
  const element = JSON.stringify((event.choices || event.candidates)[0]);
  const [head, tail] = JSON.stringify(event).split(element);
  return [head, element, tail];
};

const wireFor = (shape, eol, { prefix = "data: ", lines = one, between = "", done = true } = {}) => {
  const events = [lines(shape("one")), lines(shape("two", "STOP"))];
  if (done) events.push(["[DONE]"]);
  return events.map((payload) => payload.map((line) => `${prefix}${line}${eol}${between}`).join("") + eol).join("");
};

const table = (shape) => [
  ["LF", wireFor(shape, "\n")],
  ["CRLF", wireFor(shape, "\r\n")],
  ["CR", wireFor(shape, "\r")],
  ["data: without a space", wireFor(shape, "\n", { prefix: "data:" })],
  ["data: with extra spaces", wireFor(shape, "\n", { prefix: "data:   " })],
  ["multi-line data", wireFor(shape, "\n", { lines: split })],
  ["multi-line data, CRLF", wireFor(shape, "\r\n", { lines: pretty })],
  ["multi-line data, CR", wireFor(shape, "\r", { prefix: "data:", lines: split })],
  ["multi-line data with comments inside", wireFor(shape, "\n", { lines: pretty, between: ": ping\n" })],
  ["comments", `: ping\n\n${wireFor(shape, "\n", { between: ": ping\n" })}: ping\n\n`],
  ["blank data keepalives", `data:\n\ndata:   \n\n${wireFor(shape, "\n")}`],
  ["final frame without a blank line", wireFor(shape, "\n", { done: false }).trimEnd()],
  ["final frame without a blank line, CR", wireFor(shape, "\r", { done: false }).slice(0, -1)],
  ["final frame without any newline end", wireFor(shape, "\r\n", { done: false }).slice(0, -4)],
  ["final multi-line frame without a blank line", wireFor(shape, "\n", { lines: pretty, done: false }).trimEnd()],
  ["final multi-line frame with one newline", wireFor(shape, "\n", { lines: split, done: false }).slice(0, -1)],
  ["[DONE] without a blank line", wireFor(shape, "\n").trimEnd()],
];

// Chunk sizes: every byte apart splits each CRLF and field name; the last is one read.
const SIZES = [1, 3, 1 << 20];

const body = (wire, size) => new ReadableStream({
  start(controller) {
    const bytes = encoder.encode(wire);
    for (let i = 0; i < bytes.length; i += size) controller.enqueue(bytes.slice(i, i + size));
    controller.close();
  },
});

/** The events the shared reader sees in a stream, without the [DONE] sentinel. */
const sharedEvents = (wire) => {
  const reader = createSseFrameReader();
  return [...reader.push(wire), ...reader.flush()]
    .filter((frame) => frame.data.trim() && frame.data.trim() !== "[DONE]")
    .map((frame) => JSON.parse(frame.data));
};
const textOf = (event) =>
  event.candidates?.[0]?.content?.parts?.[0]?.text ?? event.choices?.[0]?.delta?.content ?? event.delta?.text;
const texts = (wire) => sharedEvents(wire).map(textOf).filter(Boolean);

const run = (wire, size, options) =>
  new Response(body(wire, size).pipeThrough(createSSEStream({ model: "m", ...options }))).text();

const guard = async (wire, size) => {
  const reexecute = vi.fn();
  const stream = createEmptyRetryStream({ body: body(wire, size), reexecute, baseDelayMs: 1 });
  const text = await new Response(stream).text();
  expect(reexecute).not.toHaveBeenCalled();
  return text;
};

describe.each(SIZES)("tricky frames, chunk size %i", (size) => {
  it.each(table(gemini))("emptyStreamGuard: %s", async (_name, wire) => {
    const out = await guard(wire, size);
    expect(sharedEvents(out)).toEqual(sharedEvents(wire));
    expect(texts(out)).toEqual(["one", "two"]);
  });

  it.each(table(gemini))("Gemini passthrough: %s", async (_name, wire) => {
    const out = await run(wire, size, { mode: "passthrough", targetFormat: FORMATS.GEMINI, provider: "gemini" });
    // The transform adds estimated usage to the finish event.
    const strip = ({ usage: _usage, ...event }) => event;
    expect(sharedEvents(out).map(strip)).toEqual(sharedEvents(wire));
  });

  it.each(table(chat))("OpenAI passthrough: %s", async (_name, wire) => {
    const out = await run(wire, size, { mode: "passthrough", targetFormat: FORMATS.OPENAI });
    expect(texts(out)).toEqual(["one", "two"]);
    expect(sharedEvents(out)).toHaveLength(2);
    // Untouched lines keep their own spacing.
    expect(out.match(/data: +\[DONE\]/g)).toHaveLength(1);
  });

  it.each(table(gemini))("Gemini to OpenAI translation: %s", async (_name, wire) => {
    const out = await run(wire, size, { mode: "translate", targetFormat: FORMATS.GEMINI, sourceFormat: FORMATS.OPENAI });
    expect(texts(out)).toEqual(["one", "two"]);
    expect(out.match(/data: \[DONE\]/g)).toHaveLength(1);
  });

  it.each(table(chat))("OpenAI to Claude translation: %s", async (_name, wire) => {
    const out = await run(wire, size, { mode: "translate", targetFormat: FORMATS.OPENAI, sourceFormat: FORMATS.CLAUDE });
    expect(texts(out)).toEqual(["one", "two"]);
    expect(out.match(/event: message_stop/g)).toHaveLength(1);
  });
});

describe("stream transform framing", () => {
  const passthrough = { mode: "passthrough", targetFormat: FORMATS.OPENAI };

  it.each(["\n", "\r\n"])("forwards an untouched stream byte for byte (%j)", async (eol) => {
    const wire = [`: ping`, `data: ${JSON.stringify(chat("one"))}`, "", "data: [DONE]", "", ""].join(eol);
    for (const size of SIZES) expect(await run(wire, size, passthrough)).toBe(wire);
  });

  it.each([
    ["CR", "\r", one],
    ["multi-line LF", "\n", pretty],
  ])("delivers a %s event before the upstream closes", async (_name, eol, lines) => {
    let upstream;
    const source = new ReadableStream({ start(controller) { upstream = controller; } });
    const reader = source.pipeThrough(createSSEStream(passthrough)).getReader();
    const wire = lines(chat("one")).map((line) => `data: ${line}${eol}`).join("") + eol;
    let timer;
    try {
      upstream.enqueue(encoder.encode(wire));
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("event was held")), 1000);
      });
      const { value } = await Promise.race([reader.read(), timeout]);
      expect(texts(decoder.decode(value))).toEqual(["one"]);
    } finally {
      clearTimeout(timer);
      await reader.cancel();
    }
  });

  it("still drops a broken data line and keeps the lines that followed it", async () => {
    const good = `data: ${JSON.stringify(chat("one"))}`;
    for (const wire of [`data: {broken\n\n${good}\n\n`, `data: {broken\n${good}\n\n`, `data: {broken\n${good}\n`, `data: {broken\n${good}`]) {
      const out = await run(wire, 3, passthrough);
      expect(texts(out)).toEqual(["one"]);
      expect(out).not.toContain("broken");
    }
  });

  it("keeps a held Responses event label in front of a joined frame", async () => {
    const event = { type: "response.completed", sequence_number: 1, response: { id: "resp_1", status: "completed", output: [] } };
    const wire = `event: response.completed\r\n${pretty(event).map((line) => `data: ${line}\r\n`).join("")}\r\n`;
    const out = await run(wire, 5, { mode: "passthrough", targetFormat: FORMATS.OPENAI_RESPONSES });
    expect(out.startsWith("event: response.completed\r\ndata: {")).toBe(true);
    expect(sharedEvents(out)).toEqual([event]);
    expect(out).not.toContain("response.failed");
  });
});

// Files that still split SSE text themselves. A new entry needs a reason; a
// file that stops doing it must leave the list. Issue 2254 names none of the
// files below except stream.js and streamToJsonConverter.js: moving the rest is
// separate work.
const EXECUTORS = `
  adapta-web chatgpt-plan chatgpt-web/conversation claude-web codebuddy-protocol codex commandcode
  conol-web copilot-web deepseek-web doubao-web duckduckgo-web github grokCliCustomTools
  grokCliNamespaceTools hyperagent inner-ai kiro lmarena maxai muse-spark-web/response-parser
  notrack-web oneminai perplexity-web qoder replicate tencent-aistudio-web theoldllm
  trae twinmind yuanbao-web zai-web zed-hosted zenmux-free
`.trim().split(/\s+/);

const ALLOWED = {
  "utils/stream.js": "splits lines, not frames: the hot path also carries NDJSON and forwards each line as it arrives; fields are read by parseSseFrame",
  "utils/ollamaTransform.js": "splits lines for the same NDJSON reason and feeds createSseFrameReader",
  "transformer/streamToJsonConverter.js": "reads frames with createSseFrameReader; looks at raw lines only to drop provider keepalive blocks",
  "translator/request/openai-to-cursor.js": "not SSE: matches data: URIs",
  "utils/antigravityGeminiNative.js": "converts one provider's buffered wire text",
  "handlers/chatCore/proxyTimelineFrame.js": "diagnostic timeline view of already forwarded bytes",
  "handlers/ttsProviders/minimax.js": "provider-private audio stream parser",
  "handlers/ttsProviders/openrouter.js": "provider-private audio stream parser",
  "services/antigravityHealth.js": "passive health probe over the upstream bytes",
  "services/responseMasking.js": "rewrites forwarded wire text in place",
  "services/responseModelEcho.js": "rewrites forwarded wire text in place",
  "translator/response/kiro-to-openai.js": "decodes Kiro's own event text",
  "utils/emptyStreamTerminal.js": "scans forwarded wire text for a missing terminal",
  "utils/geminiLongDecode.js": "rewrites forwarded wire text in place",
  "utils/kiroCreateResponse.js": "decodes Kiro's own event text",
  "utils/streamContentPeek.js": "peeks at buffered upstream lines before the stream is accepted",
  "utils/streamTerminal.js": "inspects terminal markers in wire text",
  ...Object.fromEntries(EXECUTORS.map((name) => [
    `executors/${name}.js`,
    "provider-private upstream protocol parser inside its executor",
  ])),
};
// port(upstream): #5902 migrated executors/codebuddy-protocol.js to open-sse/utils/sseFrames.js.
delete ALLOWED["executors/codebuddy-protocol.js"];

const root = fileURLToPath(new URL("../../open-sse/", import.meta.url));
// A `data:`/`event:` field test next to line or frame splitting.
const FIELD = /(?:startsWith|indexOf)\(\s*["'`](?:data|event):|\/\^(?:\\s\*)?(?:data|event):|sseLineData\(/;
const SPLIT = /\.split\(\s*(?:["'`](?:\\r)?\\n|\/[^/\n]*\\[rn])|(?:indexOf|lastIndexOf)\(\s*["'`](?:\\r)?\\n|\/\\r\?\\n\\r\?\\n\/|\(\?:\\r\\n\|/;

const handSplitters = () =>
  readdirSync(root, { recursive: true })
    .filter((file) => /\.(?:m?js|ts)$/.test(file) && !file.split(sep).includes("node_modules"))
    .map((file) => relative(root, join(root, file)).split(sep).join("/"))
    .filter((file) => file !== "utils/sseFrames.js")
    .filter((file) => {
      const source = readFileSync(join(root, file), "utf8");
      return FIELD.test(source) && SPLIT.test(source);
    })
    .sort();

describe("no hand-written SSE splitting outside sseFrames.js", () => {
  it("lists every remaining splitter with a reason", () => {
    expect(handSplitters()).toEqual(Object.keys(ALLOWED).sort());
  });

  it.each(["utils/stream.js", "handlers/chatCore/emptyStreamGuard.js"])("%s reads fields through sseFrames", (file) => {
    const source = readFileSync(join(root, file), "utf8");
    expect(source).toMatch(/from "(?:\.\/|\.\.\/\.\.\/utils\/)sseFrames\.js"/);
    expect(source).not.toMatch(/startsWith\(["']data:|slice\(5\)|\/\^data:\\s/);
  });
});
