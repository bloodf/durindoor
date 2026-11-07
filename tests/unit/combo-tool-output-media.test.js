// #1090: images returned inside tool outputs must count for capability admission.
import { describe, expect, it, vi } from "vitest";
import {
  detectRequiredCapabilities,
  detectToolOutputCapabilities,
  handleComboChat,
} from "../../open-sse/services/combo.js";
import { applyVisionBridgeReroute } from "../../open-sse/services/model.js";

const PNG = "data:image/png;base64,iVBORw0KGgo=";

const BODIES = {
  chatTool: {
    messages: [
      { role: "user", content: "take a screenshot" },
      { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "shot", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "call_1", content: [{ type: "image_url", image_url: { url: PNG } }] },
    ],
  },
  claudeToolResult: {
    messages: [
      { role: "user", content: "take a screenshot" },
      { role: "assistant", content: [{ type: "tool_use", id: "toolu_1", name: "shot", input: {} }] },
      {
        role: "user",
        content: [{
          type: "tool_result",
          tool_use_id: "toolu_1",
          content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" } }],
        }],
      },
    ],
  },
  responsesFunctionOutput: {
    input: [
      { type: "message", role: "user", content: [{ type: "input_text", text: "take a screenshot" }] },
      { type: "function_call", call_id: "call_1", name: "shot", arguments: "{}" },
      { type: "function_call_output", call_id: "call_1", output: [{ type: "input_image", image_url: PNG }] },
    ],
  },
  responsesCustomOutput: {
    input: [
      { type: "custom_tool_call", call_id: "call_2", name: "shot", input: "" },
      { type: "custom_tool_call_output", call_id: "call_2", output: [{ type: "input_image", image_url: PNG }] },
    ],
  },
  geminiFunctionResponse: {
    contents: [
      { role: "user", parts: [{ text: "take a screenshot" }] },
      { role: "model", parts: [{ functionCall: { name: "shot", args: {} } }] },
      {
        role: "user",
        parts: [{
          functionResponse: {
            name: "shot",
            response: { ok: true },
            parts: [{ inlineData: { mimeType: "image/png", data: "iVBORw0KGgo=" } }],
          },
        }],
      },
    ],
  },
};

describe("detectToolOutputCapabilities", () => {
  it.each(Object.entries(BODIES))("detects a nested tool-output image in %s", (_name, body) => {
    expect(detectToolOutputCapabilities(body)).toEqual(new Set(["vision"]));
    expect(detectRequiredCapabilities(body).has("vision")).toBe(true);
  });

  it("detects images in Antigravity-wrapped Gemini function responses", () => {
    const body = { request: { contents: BODIES.geminiFunctionResponse.contents } };
    expect(detectToolOutputCapabilities(body)).toEqual(new Set(["vision"]));
  });

  it("detects PDF tool output without requiring vision", () => {
    const body = {
      messages: [{
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "t", content: [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: "AA==" } }] }],
      }],
    };
    expect(detectToolOutputCapabilities(body)).toEqual(new Set(["pdf"]));
  });

  it("detects base64 PDF bytes and declared PDF files without a media type", () => {
    const pdfBytes = Buffer.from("%PDF-1.7\n").toString("base64");
    expect(detectToolOutputCapabilities({
      input: [{ type: "function_call_output", call_id: "c", output: [{ type: "input_file", file_data: pdfBytes }] }],
    })).toEqual(new Set(["pdf"]));
    expect(detectToolOutputCapabilities({
      input: [{ type: "function_call_output", call_id: "c", output: [{ type: "input_file", file_data: "data:application/pdf;base64,AA==" }] }],
    })).toEqual(new Set(["pdf"]));
    expect(detectToolOutputCapabilities({
      messages: [{ role: "tool", tool_call_id: "c", content: [{ type: "file", file: { filename: "report.PDF", file_id: "f" } }] }],
    })).toEqual(new Set(["pdf"]));
  });

  it("does not require pdf for text documents or CSV files", () => {
    const csv = Buffer.from("a,b\n1,2\n").toString("base64");
    const bodies = [
      { messages: [{ role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: [
        { type: "document", source: { type: "text", media_type: "text/plain", data: "plain notes" } },
      ] }] }] },
      { input: [{ type: "function_call_output", call_id: "c", output: [
        { type: "input_file", filename: "data.csv", file_data: `data:text/csv;base64,${csv}` },
      ] }] },
      { input: [{ type: "function_call_output", call_id: "c", output: [
        { type: "input_file", filename: "data.csv", file_data: csv },
      ] }] },
    ];
    for (const body of bodies) expect(detectToolOutputCapabilities(body)).toEqual(new Set());
  });

  it("forwards a CSV tool output through a combo with no pdf member", async () => {
    const handleSingleModel = vi.fn(async () => new Response("ok", { status: 200 }));
    const body = { input: [{ type: "function_call_output", call_id: "c", output: [
      { type: "input_file", filename: "data.csv", file_data: "data:text/csv;base64,YSxiCg==" },
    ] }] };

    const res = await handleComboChat({
      body, models: [TEXT], handleSingleModel, log, comboName: "text", comboStrategy: "fallback", capabilitiesMap: caps,
    });

    expect(res.status).toBe(200);
    expect(handleSingleModel).toHaveBeenCalledOnce();
  });

  it("ignores tool-output images from completed turns", () => {
    const body = {
      messages: [
        ...BODIES.claudeToolResult.messages,
        { role: "assistant", content: "It shows a login page." },
        { role: "user", content: "thanks" },
      ],
    };
    expect(detectToolOutputCapabilities(body)).toEqual(new Set());
    expect(detectRequiredCapabilities(body).has("vision")).toBe(false);
  });

  it("ignores text-only tool outputs and top-level user images", () => {
    expect(detectToolOutputCapabilities({ input: [{ type: "function_call_output", call_id: "c", output: "plain" }] })).toEqual(new Set());
    expect(detectToolOutputCapabilities({
      messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: PNG } }] }],
    })).toEqual(new Set());
  });
});

const TEXT = "p/text-only";
const VISION = "p/vision";
const caps = new Map([[TEXT, { vision: false }], [VISION, { vision: true }]]);
const log = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() };

function runCombo(body, models, handleSingleModel) {
  return handleComboChat({
    body,
    models,
    handleSingleModel,
    log,
    comboName: "mixed",
    comboStrategy: "fallback",
    capabilitiesMap: caps,
  });
}

describe("combo admission for tool-output media", () => {
  it.each(Object.entries(BODIES))("routes %s only to the vision member with the body intact", async (_name, body) => {
    const snapshot = structuredClone(body);
    const handleSingleModel = vi.fn(async () => new Response("ok", { status: 200 }));

    const res = await runCombo(body, [TEXT, VISION], handleSingleModel);

    expect(res.status).toBe(200);
    expect(handleSingleModel.mock.calls.map(([, model]) => model)).toEqual([VISION]);
    // Call/result ids and media reach the member unchanged.
    expect(handleSingleModel.mock.calls[0][0]).toEqual(snapshot);
  });

  it("returns an explicit capability error when no member can read the tool output", async () => {
    const handleSingleModel = vi.fn();

    const res = await runCombo(BODIES.claudeToolResult, [TEXT], handleSingleModel);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe("capability_unavailable");
    expect(json.error.message).toContain("vision");
    expect(handleSingleModel).not.toHaveBeenCalled();
  });

  it("never falls back to a text-only member when the vision member is denied by ACL", async () => {
    const handleSingleModel = vi.fn(async () => new Response(
      JSON.stringify({ error: { message: "Model not allowed for this API key" } }),
      { status: 403, headers: { "Content-Type": "application/json" } },
    ));

    const res = await runCombo(BODIES.responsesFunctionOutput, [VISION, TEXT], handleSingleModel);

    expect(res.status).toBe(403);
    expect(handleSingleModel.mock.calls.map(([, model]) => model)).toEqual([VISION]);
  });

  it("keeps every member for top-level images, which the strip pass can degrade", async () => {
    const handleSingleModel = vi.fn(async (_b, model) => new Response("x", { status: model === VISION ? 500 : 200 }));
    const body = { messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: PNG } }] }] };

    const res = await runCombo(body, [TEXT, VISION], handleSingleModel);

    expect(res.status).toBe(200);
    expect(handleSingleModel.mock.calls.map(([, model]) => model)).toEqual([VISION, TEXT]);
  });
});

describe("Vision Bridge reroute for tool-output images", () => {
  const settings = { visionBridgeEnabled: true, visionBridgeModel: "openai/gpt-4o" };

  it("reroutes a nested tool-output image to the vision target", () => {
    const res = applyVisionBridgeReroute({
      body: BODIES.responsesFunctionOutput,
      modelStr: "minimax/MiniMax-M2.1",
      settings,
      capabilities: { vision: false },
      targetCapabilities: { vision: true },
    });
    expect(res.rerouted).toBe(true);
    expect(res.toolOutputVision).toBe(true);
    expect(res.body.input).toEqual(BODIES.responsesFunctionOutput.input);
  });

  it("flags the request when no valid target exists so the caller can fail closed", () => {
    const res = applyVisionBridgeReroute({
      body: BODIES.claudeToolResult,
      modelStr: "minimax/MiniMax-M2.1",
      settings: { visionBridgeEnabled: true },
      capabilities: { vision: false },
    });
    expect(res.rerouted).toBe(false);
    expect(res.toolOutputVision).toBe(true);
  });
});
