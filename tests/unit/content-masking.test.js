// #1112: opt-in PII / credential masking of outbound request content.
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";
import { maskRequestContent, maskText } from "../../open-sse/services/contentMasking.js";

const mocks = vi.hoisted(() => ({ execute: vi.fn(), handleNonStreamingResponse: vi.fn() }));
vi.mock("../../open-sse/executors/index.js", () => ({ getExecutor: vi.fn(() => ({ noAuth: true, execute: mocks.execute })) }));
vi.mock("../../open-sse/utils/requestLogger.js", () => ({
  createRequestLogger: vi.fn(async () => ({
    logClientRawRequest: vi.fn(), logRawRequest: vi.fn(), logTargetRequest: vi.fn(),
    logProviderResponse: vi.fn(), logConvertedResponse: vi.fn(), logError: vi.fn(),
  })),
}));
vi.mock("../../open-sse/utils/clientDetector.js", () => ({
  detectClientTool: vi.fn(() => null), isNativePassthrough: vi.fn(() => false), isCodexOriginatedHeaders: vi.fn(() => false),
}));
vi.mock("../../open-sse/utils/bypassHandler.js", () => ({ handleBypassRequest: vi.fn(() => null) }));
vi.mock("../../open-sse/handlers/chatCore/nonStreamingHandler.js", () => ({ handleNonStreamingResponse: mocks.handleNonStreamingResponse }));
vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(), appendRequestLog: vi.fn(() => Promise.resolve()), saveRequestDetail: vi.fn(() => Promise.resolve()),
}));
const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

const KEY = "sk-ant-api03-" + "A".repeat(40);
const CARD = "4111 1111 1111 1111"; // Luhn-valid test number
const ARGS = JSON.stringify({ to: "ops@example.com", token: KEY });

const chatBody = () => ({
  model: "m",
  messages: [
    { role: "system", content: "Contact admin@corp.example for access." },
    { role: "user", content: `My key is ${KEY} and my card is ${CARD}.` },
    { role: "assistant", content: null, tool_calls: [{ id: "call_ops@example.com", type: "function", function: { name: "send", arguments: ARGS } }] },
    { role: "tool", tool_call_id: "call_ops@example.com", content: "sent to ops@example.com" },
  ],
});

describe("maskText", () => {
  it("masks credentials and PII with typed placeholders", () => {
    const counts = {};
    const out = maskText(`mail bob@example.com key ${KEY} ssn 123-45-6789 tel (11) 98765-4321 cpf 123.456.789-09`, {}, counts);
    expect(out).toBe("mail [EMAIL_REDACTED] key [REDACTED:anthropic] ssn [SSN_REDACTED] tel [PHONE_REDACTED] cpf [CPF_REDACTED]");
    expect(counts).toEqual({ anthropic: 1, email: 1, ssn_us: 1, phone_br: 1, cpf: 1 });
  });

  it("avoids common false positives", () => {
    const safe = [
      "timestamp 1730000000123 and id 12345678901",
      "order 1234 5678 9012 3456 is not a Luhn number",
      "IPv6-looking code: a::b, std::vector<int>, fe80::1%lo0, ::ffff",
      "risk-assessment-v2-final and desk-lamp-model-1234567890abcdef",
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB" + "sk-" + "B".repeat(30),
    ];
    for (const s of safe) expect(maskText(s), s).toBe(s);
  });

  it("does not treat emails or numbers inside code as PII, but still masks secrets there", () => {
    const text = "Use `git config user.email dev@example.com` then\n```\nAPI_KEY=" + KEY + "\nssn = '123-45-6789'\n```";
    const out = maskText(text);
    expect(out).toContain("dev@example.com");
    expect(out).toContain("'123-45-6789'");
    expect(out).toContain("API_KEY=[REDACTED:anthropic]");
  });
});

describe("maskRequestContent", () => {
  it("off: returns the same body reference and scans nothing", () => {
    const body = chatBody();
    const res = maskRequestContent(body, { mode: "off" });
    expect(res.body).toBe(body);
    expect(res.total).toBe(0);
    expect(maskRequestContent(body).body).toBe(body);
  });

  it("warn: counts but leaves the body byte-identical", () => {
    const body = chatBody();
    const before = JSON.stringify(body);
    const res = maskRequestContent(body, { mode: "warn" });
    expect(res.body).toBe(body);
    expect(JSON.stringify(res.body)).toBe(before);
    expect(res.total).toBe(4);
    expect(JSON.stringify(res.counts)).not.toContain("example.com");
  });

  it("mask: rewrites text, never tool ids/args, never mutates the caller body", () => {
    const body = chatBody();
    const before = JSON.stringify(body);
    const res = maskRequestContent(body, { mode: "mask" });
    expect(JSON.stringify(body)).toBe(before);
    const [sys, user, asst, tool] = res.body.messages;
    expect(sys.content).toBe("Contact [EMAIL_REDACTED] for access.");
    expect(user.content).toBe("My key is [REDACTED:anthropic] and my card is [CARD_REDACTED].");
    expect(asst).toBe(body.messages[2]);
    expect(asst.tool_calls[0].function.arguments).toBe(ARGS);
    expect(tool.tool_call_id).toBe("call_ops@example.com");
    expect(tool.content).toBe("sent to [EMAIL_REDACTED]");
  });

  it("masks nested Claude tool_result content and keeps tool_use and media untouched", () => {
    const image = { type: "image", source: { type: "base64", media_type: "image/png", data: "QUJDRA==" } };
    const toolUse = { type: "tool_use", id: "toolu_1", name: "lookup", input: { email: "x@example.com" } };
    const body = {
      messages: [
        { role: "assistant", content: [toolUse] },
        { role: "user", content: [
          { type: "tool_result", tool_use_id: "toolu_1", content: [{ type: "text", text: "owner: x@example.com" }, image] },
        ] },
      ],
    };
    const res = maskRequestContent(body, { mode: "mask" });
    expect(res.body.messages[0]).toBe(body.messages[0]);
    const result = res.body.messages[1].content[0];
    expect(result.tool_use_id).toBe("toolu_1");
    expect(result.content[0].text).toBe("owner: [EMAIL_REDACTED]");
    expect(result.content[1]).toBe(image);
  });

  it("masks Responses tool outputs and Gemini parts without touching call ids or function calls", () => {
    const body = {
      input: [
        { type: "function_call", call_id: "fc_1", name: "sh", arguments: "{\"q\":\"a@b.co\"}" },
        { type: "function_call_output", call_id: "fc_1", output: "user a@b.co" },
        { type: "custom_tool_call_output", call_id: "ct_1", output: [{ type: "input_text", text: KEY }] },
      ],
      contents: [{ role: "user", parts: [{ text: "mail c@d.io" }, { functionCall: { name: "f", args: { e: "c@d.io" } } }] }],
    };
    const res = maskRequestContent(body, { mode: "mask" });
    expect(res.body.input[0]).toBe(body.input[0]);
    expect(res.body.input[1]).toEqual({ type: "function_call_output", call_id: "fc_1", output: "user [EMAIL_REDACTED]" });
    expect(res.body.input[2].output[0].text).toBe("[REDACTED:anthropic]");
    expect(res.body.contents[0].parts[0].text).toBe("mail [EMAIL_REDACTED]");
    expect(res.body.contents[0].parts[1]).toBe(body.contents[0].parts[1]);
  });

  it("can limit masking to credentials only", () => {
    const res = maskRequestContent({ messages: [{ role: "user", content: `a@b.co ${KEY}` }] }, { mode: "mask", pii: false });
    expect(res.body.messages[0].content).toBe("a@b.co [REDACTED:anthropic]");
  });
});

describe("chatCore wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.handleNonStreamingResponse.mockImplementation(async () => ({ success: true }));
    mocks.execute.mockImplementation(async () => ({
      response: new Response(JSON.stringify({ id: "x", object: "chat.completion", choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop", index: 0 }] }), { status: 200, headers: { "content-type": "application/json" } }),
      url: "https://example.test", headers: {}, transformedBody: null,
    }));
  });

  const run = async (contentMasking) => {
    const warn = vi.fn();
    await handleChatCore({
      body: { ...chatBody(), stream: false },
      modelInfo: { provider: "openai", model: "gpt-4o" },
      credentials: { apiKey: "k", providerSpecificData: {} },
      log: { debug: vi.fn(), info: vi.fn(), warn, error: vi.fn(), line: vi.fn() },
      connectionId: "c",
      contentMasking,
      clientRawRequest: { endpoint: "/v1/chat/completions", body: {}, headers: { accept: "application/json" } },
    });
    return { sent: JSON.stringify(mocks.execute.mock.calls.at(-1)[0].body), warn };
  };

  it("mask mode sends masked text upstream and logs counts only", async () => {
    const { sent, warn } = await run({ mode: "mask" });
    expect(sent).toContain("My key is [REDACTED:anthropic]");
    expect(sent).not.toContain("admin@corp.example");
    expect(sent).toContain("[REDACTED:anthropic]");
    expect(sent).toContain(JSON.stringify(ARGS).slice(1, -1)); // tool arguments unchanged (they hold KEY)
    const logged = warn.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(logged).toMatch(/MASKING masked 4 /);
    expect(logged).not.toContain("example.com");
    expect(logged).not.toContain(KEY.slice(0, 20));
  });

  it("off (default) and warn leave the upstream body unmasked", async () => {
    expect((await run(null)).sent).toContain(`My key is ${KEY}`);
    const warned = await run({ mode: "warn" });
    expect(warned.sent).toContain(`My key is ${KEY}`);
    expect(warned.warn.mock.calls.map((c) => c.join(" ")).join("\n")).toMatch(/MASKING detected 4 /);
  });
});
