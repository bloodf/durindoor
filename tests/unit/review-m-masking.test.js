// #2238 (linear PRIVATE KEY scan) and #2239 (masking coverage gaps).
import { describe, expect, it } from "vitest";
import { maskRequestContent, maskText } from "../../open-sse/services/contentMasking.js";
import { applyResponseMasking } from "../../open-sse/services/responseMasking.js";

const KEY = "sk-ant-api03-" + "A".repeat(40);
const MASK = { mode: "mask" };
const BEGIN = "-----BEGIN PRIVATE KEY-----";
const END = "-----END PRIVATE KEY-----";

const jsonResult = (body, type = "application/json") => ({
  success: true,
  response: new Response(typeof body === "string" ? body : JSON.stringify(body), { status: 200, headers: { "content-type": type } }),
});
const chunked = (text, type, size = 17) => {
  const enc = new TextEncoder();
  let at = 0;
  const body = new ReadableStream({
    pull(c) {
      if (at >= text.length) return c.close();
      c.enqueue(enc.encode(text.slice(at, at + size)));
      at += size;
    },
  });
  return { success: true, response: new Response(body, { status: 200, headers: { "content-type": type } }) };
};
const maskJson = async (body) => JSON.parse(await (await applyResponseMasking(jsonResult(body), MASK)).response.text());

describe("#2238 PRIVATE KEY scan is linear", () => {
  it("does not block on a megabyte of unclosed BEGIN markers", () => {
    const text = BEGIN.repeat(Math.ceil(1_000_000 / BEGIN.length));
    const start = performance.now();
    const out = maskText(text);
    const elapsed = performance.now() - start;
    expect(out).toBe(text);
    expect(elapsed).toBeLessThan(500);
  });

  it("stays fast through maskRequestContent and response masking", async () => {
    const text = BEGIN.repeat(Math.ceil(600_000 / BEGIN.length));
    const start = performance.now();
    const res = maskRequestContent({ messages: [{ role: "user", content: text }] }, MASK);
    expect(res.total).toBe(0);
    const out = await maskJson({ choices: [{ message: { content: text } }] });
    expect(out.choices[0].message.content).toBe(text);
    expect(performance.now() - start).toBeLessThan(1500);
  });

  it("still masks closed blocks, the way the lazy regex did", () => {
    const counts = {};
    const text = `${BEGIN} dangling ${BEGIN}\nMIIE\n${END} tail`;
    expect(maskText(text, {}, counts)).toBe("[REDACTED:private_key] tail");
    expect(counts.private_key).toBe(1);
    expect(maskText(`${BEGIN}${"x".repeat(20001)}${END} ${BEGIN}z${END}`)).toBe(`${BEGIN}${"x".repeat(20001)}${END} [REDACTED:private_key]`);
    expect(maskText(`a ${BEGIN}x${END} b ${BEGIN}y${END}`)).toBe("a [REDACTED:private_key] b [REDACTED:private_key]");
  });

  it("keeps the 20000 character body limit", () => {
    const far = `${BEGIN}${"x".repeat(20001)}${END}`;
    expect(maskText(far)).toBe(far);
    expect(maskText(`${BEGIN}${"x".repeat(20000)}${END}`)).toBe("[REDACTED:private_key]");
  });
});

describe("#2239 response masking gaps", () => {
  it("masks Chat message.refusal and refusal content parts", async () => {
    const out = await maskJson({ choices: [
      { message: { role: "assistant", content: null, refusal: `no ${KEY}` } },
      { message: { role: "assistant", content: [{ type: "refusal", refusal: `no ${KEY}` }] } },
    ] });
    expect(out.choices[0].message.refusal).toBe("no [REDACTED:anthropic]");
    expect(out.choices[1].message.content[0].refusal).toBe("no [REDACTED:anthropic]");
  });

  it("masks unsigned Claude thinking blocks and leaves signed ones alone", async () => {
    const out = await maskJson({ type: "message", content: [
      { type: "thinking", thinking: `t ${KEY}` },
      { type: "thinking", thinking: `t ${KEY}`, signature: "c2ln" },
    ] });
    expect(out.content[0].thinking).toBe("t [REDACTED:anthropic]");
    expect(out.content[1].thinking).toBe(`t ${KEY}`);
  });

  it("masks application/x-ndjson bodies line by line, across chunk boundaries", async () => {
    const lines = [
      { choices: [{ index: 0, message: { role: "assistant", content: `k ${KEY}` } }] },
      { type: "message", content: [{ type: "text", text: `k ${KEY}` }] },
    ];
    const raw = `${lines.map((l) => JSON.stringify(l)).join("\n")}\nnot json\n`;
    const res = await applyResponseMasking(chunked(raw, "application/x-ndjson"), MASK);
    const out = (await res.response.text()).split("\n");
    expect(JSON.parse(out[0]).choices[0].message.content).toBe("k [REDACTED:anthropic]");
    expect(JSON.parse(out[1]).content[0].text).toBe("k [REDACTED:anthropic]");
    expect(out[2]).toBe("not json");
  });

  it("warn mode forwards ndjson bytes unchanged", async () => {
    const raw = `${JSON.stringify({ choices: [{ message: { content: KEY } }] })}\n`;
    const res = await applyResponseMasking(chunked(raw, "application/x-ndjson"), { mode: "warn" });
    expect(await res.response.text()).toBe(raw);
  });
});

describe("#2239 request masking gaps", () => {
  it("masks Gemini functionResponse.response string leaves and leaves functionCall alone", () => {
    const call = { functionCall: { name: "send", args: { token: KEY } } };
    const body = { contents: [{ role: "user", parts: [
      { functionResponse: { name: "lookup", response: { result: { note: `key ${KEY}`, items: [`x ${KEY}`], count: 2 } } } },
      call,
    ] }] };
    const { body: out } = maskRequestContent(body, MASK);
    const [resp, kept] = out.contents[0].parts;
    expect(resp.functionResponse.name).toBe("lookup");
    expect(resp.functionResponse.response.result).toEqual({ note: "key [REDACTED:anthropic]", items: ["x [REDACTED:anthropic]"], count: 2 });
    expect(kept).toEqual(call);
    expect(body.contents[0].parts[0].functionResponse.response.result.note).toContain(KEY);
  });

  it("masks Claude document text sources and leaves base64 sources alone", () => {
    const pdf = { type: "document", source: { type: "base64", media_type: "application/pdf", data: KEY } };
    const body = { messages: [{ role: "user", content: [
      { type: "document", source: { type: "text", media_type: "text/plain", data: `doc ${KEY}` } },
      { type: "document", source: { type: "content", content: [{ type: "text", text: `c ${KEY}` }] } },
      pdf,
    ] }] };
    const parts = maskRequestContent(body, MASK).body.messages[0].content;
    expect(parts[0].source.data).toBe("doc [REDACTED:anthropic]");
    expect(parts[1].source.content[0].text).toBe("c [REDACTED:anthropic]");
    expect(parts[2]).toEqual(pdf);
  });

  it("masks chat tools[].function.description and messages[].name", () => {
    const body = {
      messages: [{ role: "user", name: "bob@corp.example", content: "hi" }],
      tools: [{ type: "function", function: { name: "send", description: `use ${KEY}`, parameters: { type: "object" } } }],
    };
    const out = maskRequestContent(body, MASK).body;
    expect(out.tools[0].function.description).toBe("use [REDACTED:anthropic]");
    expect(out.tools[0].function.name).toBe("send");
    expect(out.messages[0].name).toBe("[EMAIL_REDACTED]");
  });
});

describe("#2239 value rules", () => {
  const hex = "9f2c4e7a1b3d5f60a8c2e4";
  it("masks Authorization: Bearer <hex>", () => {
    expect(maskText(`Authorization: Bearer ${hex}`)).toBe("Authorization: Bearer [REDACTED:bearer]");
    expect(maskText(`-H "Authorization: Bearer ${hex}"`)).toContain("[REDACTED:bearer]");
    expect(maskText("Authorization: Bearer <token>")).toBe("Authorization: Bearer <token>");
  });

  it("masks DB_PASS style labels without touching bypass/compass", () => {
    expect(maskText(`DB_PASS=${hex}`)).toBe("DB_PASS=[REDACTED:secret]");
    expect(maskText(`pwd: ${hex}`)).toBe("pwd: [REDACTED:secret]");
    expect(maskText(`bypass=${hex}`)).toBe(`bypass=${hex}`);
  });

  it("masks quoted passwords that contain spaces", () => {
    expect(maskText(`password = "correct horse battery staple"`)).toBe(`password = "[REDACTED:secret]"`);
    expect(maskText(`{"db_pass": 'long enough value here!'}`)).toContain("[REDACTED:secret]");
  });

  it("masks connection strings whose password contains a colon", () => {
    expect(maskText("postgres://user:pa:ss@h/db")).toBe("[REDACTED:connection_string]h/db");
  });

  it("anchors the placeholder words", () => {
    expect(maskText(`api_key=sk_${"a1b2".repeat(4)}exampleZZ9`)).toContain("[REDACTED:secret]");
    expect(maskText(`password=${hex}placeholder1`)).toContain("[REDACTED:secret]");
    expect(maskText("api_key=example_value_12345")).toBe("api_key=example_value_12345");
    expect(maskText("api_key=placeholder-value-0")).toBe("api_key=placeholder-value-0");
    expect(maskText("password=my-secret-example")).toBe("password=my-secret-example");
  });
});
