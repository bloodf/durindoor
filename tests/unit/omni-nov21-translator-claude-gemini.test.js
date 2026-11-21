import { describe, expect, it } from "vitest";
import "../translator/registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { openaiToClaudeRequest } from "../../open-sse/translator/request/openai-to-claude.js";
import { openaiToGeminiRequest, openaiToAntigravityRequest } from "../../open-sse/translator/request/openai-to-gemini.js";
import { openaiToKiroRequest } from "../../open-sse/translator/request/openai-to-kiro.js";
import { claudeToOpenAIResponse } from "../../open-sse/translator/response/claude-to-openai.js";
import { geminiToOpenAIResponse } from "../../open-sse/translator/response/gemini-to-openai.js";
import { parseGeminiSSEToOpenAIResponse } from "../../open-sse/handlers/chatCore/sseToJsonHandler.js";

const USER = [{ role: "user", content: "hi" }];
const CLAUDE_MODEL = "claude-sonnet-4-5";

// ── #20167 Claude empty streamed tool arguments ───────────────────────────────────────────
describe("#20167 Claude stream: parameterless tool closes with {} arguments", () => {
  const start = (state, index = 0, name = "get_time") => {
    claudeToOpenAIResponse({ type: "message_start", message: { id: "msg_1", model: "claude-sonnet-4-6" } }, state);
    return claudeToOpenAIResponse({ type: "content_block_start", index, content_block: { type: "tool_use", id: `call_${index}`, name, input: {} } }, state);
  };

  it("emits and stores exactly one {} delta when no input_json_delta arrives", () => {
    const state = { toolCalls: new Map() };
    start(state);
    const stopped = claudeToOpenAIResponse({ type: "content_block_stop", index: 0 }, state);
    expect(stopped).toHaveLength(1);
    expect(stopped[0].choices[0].delta.tool_calls).toEqual([{ index: 0, id: "call_0", function: { arguments: "{}" } }]);
    expect(state.toolCalls.get(0).function.arguments).toBe("{}");
    // A repeated stop for the same block adds nothing more.
    expect(claudeToOpenAIResponse({ type: "content_block_stop", index: 0 }, state)).toBeNull();
  });

  it("treats an empty partial_json like an absent one", () => {
    const state = { toolCalls: new Map() };
    start(state);
    const delta = claudeToOpenAIResponse({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "" } }, state);
    const stopped = claudeToOpenAIResponse({ type: "content_block_stop", index: 0 }, state);
    expect(delta).toBeNull();
    expect(stopped[0].choices[0].delta.tool_calls[0].function.arguments).toBe("{}");
    expect(state.toolCalls.get(0).function.arguments).toBe("{}");
  });

  it("leaves streamed arguments untouched and closes each tool independently", () => {
    const state = { toolCalls: new Map() };
    start(state, 0, "get_time");
    expect(claudeToOpenAIResponse({ type: "content_block_stop", index: 0 }, state)[0].choices[0].delta.tool_calls[0].function.arguments).toBe("{}");
    claudeToOpenAIResponse({ type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "call_1", name: "format_time" } }, state);
    claudeToOpenAIResponse({ type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"fmt":' } }, state);
    claudeToOpenAIResponse({ type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '"iso"}' } }, state);
    expect(claudeToOpenAIResponse({ type: "content_block_stop", index: 1 }, state)).toBeNull();
    expect(state.toolCalls.get(0).function.arguments).toBe("{}");
    expect(state.toolCalls.get(1).function.arguments).toBe('{"fmt":"iso"}');
    const end = claudeToOpenAIResponse({ type: "message_delta", delta: { stop_reason: "tool_use" } }, state);
    expect(end.at(-1).choices[0].finish_reason).toBe("tool_calls");
  });

  it("does not touch text blocks", () => {
    const state = { toolCalls: new Map() };
    claudeToOpenAIResponse({ type: "message_start", message: { id: "m", model: "c" } }, state);
    claudeToOpenAIResponse({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }, state);
    expect(claudeToOpenAIResponse({ type: "content_block_stop", index: 0 }, state)).toBeNull();
  });
});

// ── #20204 OpenAI → Claude request shapes ─────────────────────────────────────────────────
describe("#20204 OpenAI → Claude request fixes", () => {
  it("keeps the text of a bare block-object system and user content", () => {
    const system = openaiToClaudeRequest(CLAUDE_MODEL, { messages: [{ role: "system", content: { type: "text", text: "SYSTEM-BARE" } }, ...USER] }, false).system;
    expect(JSON.stringify(system)).toContain("SYSTEM-BARE");
    const messages = openaiToClaudeRequest(CLAUDE_MODEL, { messages: [{ role: "user", content: { type: "text", text: "USER-BARE" } }] }, false).messages;
    expect(JSON.stringify(messages)).toContain("USER-BARE");
  });

  it("leaves string and array content unchanged", () => {
    const out = openaiToClaudeRequest(CLAUDE_MODEL, { messages: [{ role: "system", content: [{ type: "text", text: "SYS-ARR" }] }, { role: "user", content: "USER-STR" }] }, false);
    expect(out.system[0].text).toBe("SYS-ARR");
    expect(out.messages[0].content).toEqual([{ type: "text", text: "USER-STR" }]);
    expect(openaiToClaudeRequest(CLAUDE_MODEL, { messages: [{ role: "user", content: null }, ...USER] }, false).messages).toHaveLength(1);
  });

  it("drops empty system text instead of sending an empty block", () => {
    expect(openaiToClaudeRequest(CLAUDE_MODEL, { messages: [{ role: "system", content: "" }, ...USER] }, false).system).toBeUndefined();
    const kept = openaiToClaudeRequest(CLAUDE_MODEL, { messages: [{ role: "system", content: "" }, { role: "system", content: "Be brief." }, ...USER] }, false).system;
    expect(kept.map((block) => block.text).join("|")).toBe("Be brief.");
    const claudeProvider = openaiToClaudeRequest(CLAUDE_MODEL, { messages: [{ role: "system", content: "" }, ...USER] }, false, null, { provider: "claude" }).system;
    expect(claudeProvider.every((block) => block.text !== "")).toBe(true);
  });

  it("removes only the rotating billing line on the claude provider", () => {
    const line = "x-anthropic-billing-header: cc_version=2.1.300.a1b; cch=0f3a1;";
    const system = openaiToClaudeRequest(CLAUDE_MODEL, { messages: [{ role: "system", content: `${line}\nKeep me` }, ...USER] }, false, null, { provider: "claude" }).system;
    expect(JSON.stringify(system)).toContain("Keep me");
    expect(JSON.stringify(system)).not.toContain("x-anthropic-billing-header");
  });

  it("sends MIME-wrapped base64 images and PDFs as clean base64 blocks", () => {
    const content = openaiToClaudeRequest(CLAUDE_MODEL, {
      messages: [{
        role: "user",
        content: [
          { type: "image_url", image_url: { url: "data:image/png;base64,AAAA\nBBBB\r\nCCCC" } },
          { type: "file", file: { filename: "a.pdf", file_data: "data:application/pdf;base64,JVBE\nRi0x" } }
        ]
      }]
    }, false).messages[0].content;
    expect(content[0]).toEqual({ type: "image", source: { type: "base64", media_type: "image/png", data: "AAAABBBBCCCC" } });
    expect(content[1]).toEqual({ type: "document", source: { type: "base64", media_type: "application/pdf", data: "JVBERi0x" } });
  });

  it("cleans wrapped base64 in tool-result images and keeps plain data URLs and https URLs", () => {
    const messages = openaiToClaudeRequest(CLAUDE_MODEL, {
      messages: [
        { role: "user", content: "go" },
        { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "shot", arguments: "{}" } }] },
        { role: "tool", tool_call_id: "call_1", content: [{ type: "image_url", image_url: { url: "data:image/png;base64,AA\nBB" } }] },
        { role: "user", content: [
          { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
          { type: "image_url", image_url: { url: "https://example.test/a.png" } }
        ] }
      ]
    }, false).messages;
    const toolResult = messages.find((m) => m.content.some((b) => b.type === "tool_result")).content[0];
    expect(toolResult.content[0].source.data).toBe("AABB");
    const last = messages.at(-1).content;
    expect(last[0].source.data).toBe("AAAA");
    expect(last[1].source).toEqual({ type: "url", url: "https://example.test/a.png" });
  });

  const translate = (body, provider = "anthropic") =>
    translateRequest(FORMATS.OPENAI, FORMATS.CLAUDE, CLAUDE_MODEL, structuredClone(body), false, { apiKey: "test" }, provider);

  it("gives enabled thinking without a usable budget a positive budget_tokens below max_tokens", () => {
    for (const thinking of [{ type: "enabled" }, { type: "enabled", budget_tokens: 0 }]) {
      const out = translate({ messages: USER, thinking });
      expect(out.thinking.type).toBe("enabled");
      expect(out.thinking.budget_tokens).toBeGreaterThan(0);
      expect(out.max_tokens).toBeGreaterThan(out.thinking.budget_tokens);
    }
  });

  it("keeps an explicit budget and leaves disabled or absent thinking alone", () => {
    expect(translate({ messages: USER, thinking: { type: "enabled", budget_tokens: 4096 }, max_tokens: 20000 }).thinking.budget_tokens).toBe(4096);
    expect(translate({ messages: USER, thinking: { type: "disabled" } }).thinking).toEqual({ type: "disabled" });
    expect(translate({ messages: USER }).thinking).toBeUndefined();
  });

  it("keeps temperature when thinking is off or disabled (existing behavior)", () => {
    expect(translate({ messages: USER, temperature: 0.2 }).temperature).toBe(0.2);
    expect(translate({ messages: USER, temperature: 0.2, thinking: { type: "disabled" } }).temperature).toBe(0.2);
  });

  it("never sends a forced tool choice together with thinking (existing behavior)", () => {
    const out = translate({
      messages: USER,
      reasoning_effort: "low",
      tools: [{ type: "function", function: { name: "inspect", parameters: { type: "object", properties: {} } } }],
      tool_choice: "required"
    });
    expect(out.thinking?.type === "enabled" ? out.tool_choice.type : "auto").toBe("auto");
  });
});

// ── #20204 OpenAI → Gemini request fixes ──────────────────────────────────────────────────
describe("#20204 OpenAI → Gemini request fixes", () => {
  const BILLING = "x-anthropic-billing-header: cc_version=2.1.300.a1b; cc_entrypoint=cli; cch=0f3a1;";
  const withSystem = (content) => ({ messages: [{ role: "system", content }, ...USER] });

  it("drops only the billing line from a string system message", () => {
    const system = openaiToGeminiRequest("gemini-3-pro", withSystem(`${BILLING}\nYou are a careful reviewer.`), false).systemInstruction;
    expect(system.parts).toEqual([{ text: "You are a careful reviewer." }]);
  });

  it("strips the billing line from each block of a block-form system message", () => {
    const system = openaiToGeminiRequest("gemini-3-pro", withSystem([{ type: "text", text: BILLING }, { type: "text", text: "Reviewer." }]), false).systemInstruction;
    expect(JSON.stringify(system)).not.toContain("x-anthropic-billing-header");
    expect(JSON.stringify(system)).toContain("Reviewer.");
  });

  it("leaves no empty system part when the message was only the billing line", () => {
    expect(openaiToGeminiRequest("gemini-3-pro", withSystem(BILLING), false).systemInstruction).toBeUndefined();
  });

  it("leaves client text that merely mentions the header, and plain system text, unchanged", () => {
    const mention = "Do not echo x-anthropic-billing-header: values.";
    expect(openaiToGeminiRequest("gemini-3-pro", withSystem(mention), false).systemInstruction.parts[0].text).toBe(mention);
    expect(openaiToGeminiRequest("gemini-3-pro", withSystem(`first\n${BILLING}`), false).systemInstruction.parts[0].text).toBe(`first\n${BILLING}`);
    expect(openaiToGeminiRequest("gemini-3-pro", withSystem("Plain."), false).systemInstruction.parts[0].text).toBe("Plain.");
  });

  it("drops the billing line for Antigravity too", () => {
    const wire = JSON.stringify(openaiToAntigravityRequest("gemini-3-pro", withSystem(`${BILLING}\nKeep.`), false).request.systemInstruction);
    expect(wire).not.toContain("x-anthropic-billing-header");
    expect(wire).toContain("Keep.");
  });

  const toolTurn = (content) => [
    { role: "user", content: "take a screenshot" },
    { role: "assistant", tool_calls: [{ id: "call_image", type: "function", function: { name: "screenshot", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "call_image", content }
  ];

  it("keeps tool-result images as media parts and the tool text as the result", () => {
    const parts = openaiToGeminiRequest("gemini-2.5-flash", {
      messages: toolTurn([{ type: "text", text: "screen ready" }, { type: "image_url", image_url: { url: "data:image/png;base64,AQIDBA==" } }])
    }, false).contents.flatMap((content) => content.parts);
    expect(parts.find((part) => part.inlineData).inlineData).toEqual({ mimeType: "image/png", data: "AQIDBA==" });
    expect(parts.find((part) => part.functionResponse).functionResponse.response.result).toEqual({ result: "screen ready" });
  });

  it("keeps remote tool-result image URLs visible in the result and plain string results unchanged", () => {
    const withUrl = openaiToGeminiRequest("gemini-2.5-flash", {
      messages: toolTurn([{ type: "text", text: "see image" }, { type: "image_url", image_url: { url: "https://example.com/a.png" } }])
    }, false).contents.flatMap((content) => content.parts);
    expect(withUrl.some((part) => part.inlineData)).toBe(false);
    expect(JSON.stringify(withUrl.find((part) => part.functionResponse).functionResponse.response)).toContain("https://example.com/a.png");
    const plain = openaiToGeminiRequest("gemini-2.5-flash", { messages: toolTurn("plain text") }, false).contents.flatMap((content) => content.parts);
    expect(plain.some((part) => part.inlineData || part.fileData)).toBe(false);
    expect(plain.find((part) => part.functionResponse).functionResponse.response.result).toEqual({ result: "plain text" });
  });

  it("splits inline media out while a remote image URL stays in the result", () => {
    const parts = openaiToGeminiRequest("gemini-2.5-flash", {
      messages: toolTurn([
        { type: "image_url", image_url: { url: "data:image/png;base64,AQIDBA==" } },
        { type: "image_url", image_url: { url: "https://example.com/b.png" } }
      ])
    }, false).contents.flatMap((content) => content.parts);
    expect(parts.filter((part) => part.inlineData)).toHaveLength(1);
    const result = JSON.stringify(parts.find((part) => part.functionResponse).functionResponse.response);
    expect(result).toContain("https://example.com/b.png");
    expect(result).not.toContain("AQIDBA==");
  });

  it("omits sampling fields on Gemini 4 (with or without a models/ prefix) and keeps them elsewhere", () => {
    const body = { messages: USER, temperature: 0.7, top_p: 0.9, top_k: 20 };
    for (const model of ["gemini-4-argon", "models/gemini-4-argon"]) {
      const config = openaiToGeminiRequest(model, body, false).generationConfig;
      for (const field of ["temperature", "topP", "topK"]) expect(config[field]).toBeUndefined();
    }
    expect(openaiToGeminiRequest("gemini-2.5-flash", body, false).generationConfig).toMatchObject({ temperature: 0.7, topP: 0.9, topK: 20 });
  });
});

// ── #20206 Gemini, Kiro and Claude → Gemini ───────────────────────────────────────────────
describe("#20206 Gemini response, Claude → Gemini and Kiro", () => {
  it("keeps a Gemini image part that carries a thought signature", () => {
    const chunks = geminiToOpenAIResponse({
      responseId: "image-signature",
      modelVersion: "gemini-3-image",
      candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "AQID" }, thoughtSignature: "sig-image" }] } }]
    }, { toolCalls: new Map() }) || [];
    const images = chunks.flatMap((chunk) => chunk.choices?.[0]?.delta?.images || []);
    expect(images).toEqual([{ type: "image_url", image_url: { url: "data:image/png;base64,AQID" } }]);
  });

  it("emits a signed text part and a signed function call once, with no stray image", () => {
    const state = { toolCalls: new Map() };
    const chunks = geminiToOpenAIResponse({
      responseId: "r",
      modelVersion: "gemini-3",
      candidates: [{ content: { parts: [{ text: "answer", thoughtSignature: "s1" }, { functionCall: { name: "f", args: { a: 1 } }, thoughtSignature: "s2" }] } }]
    }, state);
    const deltas = chunks.map((chunk) => chunk.choices[0].delta);
    expect(deltas.filter((delta) => delta.content === "answer")).toHaveLength(1);
    expect(deltas.filter((delta) => delta.tool_calls)).toHaveLength(1);
    expect(deltas.some((delta) => delta.images)).toBe(false);
  });

  it("still skips a standalone signature part and keeps unsigned images", () => {
    const state = { toolCalls: new Map() };
    const chunks = geminiToOpenAIResponse({
      responseId: "r2",
      modelVersion: "gemini-3-image",
      candidates: [{ content: { parts: [{ thoughtSignature: "only-sig" }, { inlineData: { mimeType: "image/jpeg", data: "QUJD" } }] } }]
    }, state);
    const deltas = chunks.map((chunk) => chunk.choices[0].delta);
    expect(deltas.filter((delta) => delta.images)).toHaveLength(1);
  });

  const claudeToGemini = (model, extra) =>
    translateRequest(FORMATS.CLAUDE, FORMATS.GEMINI, model, { messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }], ...extra }, false, { apiKey: "test" }, "gemini");

  it("switches Gemini 2.5 Flash thinking off explicitly for a disabled or none request (existing behavior)", () => {
    expect(claudeToGemini("gemini-2.5-flash", { thinking: { type: "disabled" } }).generationConfig.thinkingConfig).toEqual({ thinkingBudget: 0, includeThoughts: false });
    expect(claudeToGemini("gemini-2.5-flash", { output_config: { effort: "none" } }).generationConfig.thinkingConfig).toEqual({ thinkingBudget: 0, includeThoughts: false });
    expect(claudeToGemini("gemini-2.5-flash", {}).generationConfig.thinkingConfig).toBeUndefined();
    expect(claudeToGemini("gemini-2.5-flash", { thinking: { type: "enabled", budget_tokens: 2048 } }).generationConfig.thinkingConfig).toEqual({ thinkingBudget: 2048, includeThoughts: true });
  });

  it("keeps a failed unsigned tool result marked as an error and literal ampersands intact (#20240)", () => {
    const text = (content, isError) => claudeToGemini("gemini-2.5-pro", {
      messages: [
        { role: "assistant", content: [{ type: "tool_use", id: "tu1", name: "Bash", input: {} }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "tu1", content, ...(isError ? { is_error: true } : {}) }] }
      ]
    }).contents.flatMap((c) => c.parts).map((p) => p.text ?? "").join("\n");
    expect(text("boom", true)).toMatch(/\[Tool error\]\nboom/);
    expect(text("fine", false)).not.toMatch(/Tool error/);
    const replay = text("if (a && b) return x & y </end>", false);
    expect(replay).toContain("if (a && b) return x & y </end>");
    expect(replay).not.toContain("&amp;");
  });

  const bashTool = { type: "function", function: { name: "Bash", description: "run", parameters: { type: "object", properties: {} } } };
  const kiroMessage = (messages, tools = []) => openaiToKiroRequest("claude-sonnet-4.5", { messages, tools }, false, {}).conversationState.currentMessage.userInputMessage;

  it("reaches Kiro with status error for a failed tool result and success otherwise", () => {
    const history = (extra) => [
      { role: "user", content: "run it" },
      { role: "assistant", content: null, tool_calls: [{ id: "t1", type: "function", function: { name: "Bash", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "t1", content: "boom: permission denied", ...extra }
    ];
    expect(kiroMessage(history({ is_error: true }), [bashTool]).userInputMessageContext.toolResults[0]).toMatchObject({ status: "error", content: [{ text: "boom: permission denied" }] });
    expect(kiroMessage(history({}), [bashTool]).userInputMessageContext.toolResults[0].status).toBe("success");
  });

  it("says in the text when a Kiro image could not be attached, and stays quiet otherwise", () => {
    const dropped = kiroMessage([{ role: "user", content: [{ type: "text", text: "see" }, { type: "image", source: { type: "url", url: "https://example.com/a.png" } }, { type: "image_url", image_url: { url: "not-a-data-uri" } }] }]);
    expect(dropped.content).toContain("see");
    expect(dropped.content).toMatch(/\[2 images omitted/);
    expect(dropped.images).toBeUndefined();
    const single = kiroMessage([{ role: "user", content: [{ type: "image", source: { type: "url", url: "https://example.com/a.png" } }] }]);
    expect(single.content).toMatch(/\[1 image omitted/);
    const inline = kiroMessage([{ role: "user", content: [{ type: "text", text: "see" }, { type: "image_url", image_url: { url: "data:image/png;base64,QUJD" } }] }]);
    expect(inline.images).toHaveLength(1);
    expect(inline.content).not.toMatch(/omitted/);
    expect(kiroMessage([{ role: "user", content: [{ type: "text", text: "hello" }] }]).content).not.toMatch(/omitted/);
  });
});

// ── #19733 Gemini request roles and stream handling ───────────────────────────────────────
describe("#19733 Gemini request roles", () => {
  const convert = (contents) => translateRequest(FORMATS.GEMINI, FORMATS.OPENAI, "m", { contents }, false, null, null).messages;

  it("maps a role-less text content, and the function and tool roles, to user messages", () => {
    expect(convert([{ parts: [{ text: "hello" }] }])).toEqual([{ role: "user", content: "hello" }]);
    for (const role of ["function", "tool", "FUNCTION", " Tool "]) {
      expect(convert([{ role, parts: [{ text: "x" }] }])[0].role).toBe("user");
    }
  });

  it("keeps model as assistant and user as user", () => {
    expect(convert([{ role: "user", parts: [{ text: "q" }] }, { role: "model", parts: [{ text: "a" }] }].map((c) => c)).map((m) => m.role)).toEqual(["user", "assistant"]);
  });

  it("infers a role-less content from its parts and keeps tool ids paired", () => {
    const messages = convert([
      { role: "user", parts: [{ text: "go" }] },
      { parts: [{ functionCall: { name: "f", args: {} } }] },
      { role: "function", parts: [{ functionResponse: { name: "f", response: { result: "ok" } } }] }
    ]);
    expect(messages[1].role).toBe("assistant");
    expect(messages[2].role).toBe("tool");
    expect(messages[2].tool_call_id).toBe(messages[1].tool_calls[0].id);
    expect(convert([{ parts: [{ text: "thinking", thought: true }] }])).toEqual([{ role: "assistant", reasoning_content: "thinking" }]);
  });
});

describe("#19733 Gemini buffered stream (existing behavior kept)", () => {
  const event = (parts, finishReason) => `data: ${JSON.stringify({ response: { candidates: [{ content: { parts }, ...(finishReason ? { finishReason } : {}) }] } })}\n\n`;
  const call = { functionCall: { name: "get_weather", args: { city: "Oslo" } } };

  it("keeps a finished tool-only stream as a tool call and leaves a cut one without a completion", () => {
    const done = parseGeminiSSEToOpenAIResponse(event([call], "STOP"), "gemini");
    expect(done.choices[0].finish_reason).toBe("tool_calls");
    expect(JSON.parse(done.choices[0].message.tool_calls[0].function.arguments)).toEqual({ city: "Oslo" });
    expect(parseGeminiSSEToOpenAIResponse(event([call]), "gemini")).toBeNull();
  });

  it("keeps repeated legitimate text deltas intact", () => {
    const body = parseGeminiSSEToOpenAIResponse(event([{ text: "ab" }]) + event([{ text: "ab" }]) + event([{ text: "ab" }], "STOP"), "gemini");
    expect(body.choices[0].message.content).toBe("ababab");
  });
});
