// #1090: images returned inside tool outputs must count for capability admission.
import { describe, expect, it, vi } from "vitest";
vi.hoisted(() => {
  globalThis.fetch = () => { throw new Error("Unexpected network access in media admission tests"); };
});
import {
  detectRequiredCapabilities,
  detectToolOutputCapabilities,
  handleComboChat,
  handleFusionChat,
  LOCAL_POLICY_REJECTION,
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

const CHAT_TOOL_DISPATCH = { messages: [
  { role: "user", content: "take a screenshot" },
  { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "shot", arguments: "{}" } }] },
  { role: "tool", tool_call_id: "call_1", content: [{ type: "text", text: "[tool returned an image; see attached]" }] },
  { role: "user", content: [{ type: "image_url", image_url: { url: PNG } }] },
] };

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

describe("fusion media admission", () => {
  const secondVision = "p/second-vision";
  const fusionCaps = new Map([...caps, [secondVision, { vision: true }]]);
  const ok = () => Response.json({ choices: [{ message: { content: "answer" } }] });
  const run = (body, handleSingleModel, options = {}) => handleFusionChat({
    body, models: [TEXT, VISION, secondVision], handleSingleModel, log,
    comboName: "mixed", capabilitiesMap: fusionCaps, ...options,
  });

  it.each(Object.entries(BODIES))("preserves %s media and call/result IDs in panel and judge payloads", async (name, body) => {
    const original = structuredClone(body);
    const expected = name === "chatTool" ? CHAT_TOOL_DISPATCH : original;
    const handle = vi.fn(async () => ok());
    expect((await run(body, handle)).status).toBe(200);
    expect(handle.mock.calls.map(([, model]) => model)).toEqual([VISION, secondVision, VISION]);
    for (const [sent] of handle.mock.calls) {
      for (const [key, value] of Object.entries(expected)) {
        if (Array.isArray(value) && ["messages", "input", "contents"].includes(key)) {
          expect(sent[key].slice(0, value.length)).toEqual(value);
        } else expect(sent[key]).toEqual(value);
      }
    }
    expect(body).toEqual(original);
  });

  it("filters top-level images before fan-out too", async () => {
    const handle = vi.fn(async () => ok());
    await run({ messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: PNG } }] }] }, handle);
    expect(handle.mock.calls.map(([, model]) => model)).toEqual([VISION, secondVision, VISION]);
  });

  it("returns capability_unavailable without dispatch when no panel member is capable", async () => {
    const handle = vi.fn(async () => ok());
    const res = await run(BODIES.chatTool, handle, { models: [TEXT] });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("capability_unavailable");
    expect(handle).not.toHaveBeenCalled();
  });

  it.each([TEXT, "p/unknown-judge"])("rejects incapable explicit judge %s before panel dispatch", async (judgeModel) => {
    const handle = vi.fn(async () => ok());
    const res = await run(BODIES.chatTool, handle, { judgeModel });
    expect(res.status).toBe(400);
    const error = (await res.json()).error;
    expect(error.code).toBe("capability_unavailable");
    expect(error.message).not.toContain(judgeModel);
    expect(handle).not.toHaveBeenCalled();
  });

  it("honors an explicit capable judge outside the panel", async () => {
    const handle = vi.fn(async () => ok());
    await run(BODIES.chatTool, handle, { models: [VISION], judgeModel: secondVision });
    expect(handle.mock.calls.map(([, model]) => model)).toEqual([VISION, secondVision]);
  });

  it("preserves direct panel-of-one payload", async () => {
    const handle = vi.fn(async () => ok());
    await run(BODIES.chatTool, handle, { models: [TEXT, VISION] });
    expect(handle.mock.calls).toHaveLength(1);
    expect(handle.mock.calls[0][0].messages).toEqual(CHAT_TOOL_DISPATCH.messages);
    expect(handle.mock.calls[0][1]).toBe(VISION);
  });

  it("keeps explicit autoSwitch opt-out", async () => {
    const handle = vi.fn(async () => ok());
    await run(BODIES.chatTool, handle, { models: [TEXT], autoSwitch: false });
    expect(handle.mock.calls[0][1]).toBe(TEXT);
  });

  it.each(["tool", "function"])("does not classify a %s CSV file as PDF input", async (role) => {
    const body = { messages: [{ role, tool_call_id: "csv", content: [
      { type: "file", file: { filename: "report.csv", file_data: "data:text/csv;base64,YSxiCg==" } },
    ] }] };
    expect(detectToolOutputCapabilities(body)).toEqual(new Set());
    expect(detectRequiredCapabilities(body)).toEqual(new Set());
    const handle = vi.fn(async () => ok());
    const res = await run(body, handle, { models: [TEXT], capabilitiesMap: new Map([[TEXT, { pdf: false, vision: false }]]) });
    expect(res.status).toBe(200);
    expect(handle.mock.calls[0][0]).toEqual(body);
  });

  it("still rejects an actual tool PDF on a PDF-incapable member", async () => {
    const body = { messages: [{ role: "tool", tool_call_id: "pdf", content: [
      { type: "file", file: { filename: "report.pdf", file_data: "data:application/pdf;base64,JVBERi0xLjcK" } },
    ] }] };
    expect(detectRequiredCapabilities(body)).toEqual(new Set(["pdf"]));
    const handle = vi.fn();
    const res = await run(body, handle, { models: [TEXT] });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("capability_unavailable");
    expect(handle).not.toHaveBeenCalled();
  });

  it.each([{ models: [VISION] }, { models: [VISION, secondVision] }])("keeps lifted tool images non-degradable through nested fallback ($models)", async ({ models }) => {
    const attempts = vi.fn(async () => {
      const response = new Response("denied", { status: 403 });
      response[LOCAL_POLICY_REJECTION] = true;
      return response;
    });
    const handle = (body) => handleComboChat({
      body, models: [VISION, TEXT], handleSingleModel: attempts,
      capabilitiesMap: caps, comboStrategy: "fallback", comboName: "inner", log,
    });
    const res = await run(BODIES.chatTool, handle, { models });
    expect(res.status).toBe(403);
    expect(attempts.mock.calls.map(([, model]) => model)).toEqual(models.map(() => VISION));
    for (const [sent] of attempts.mock.calls) expect(sent.messages).toEqual(CHAT_TOOL_DISPATCH.messages);
  });

  it.each([{ models: [VISION] }, { models: [VISION, secondVision] }])("keeps lifted tool PDFs non-degradable through nested fallback ($models)", async ({ models }) => {
    const pdf = { type: "file", file: { filename: "report.pdf", file_data: "data:application/pdf;base64,JVBERi0xLjcK" } };
    const body = structuredClone(BODIES.chatTool);
    body.messages[2].content = [pdf];
    const pdfCaps = new Map([[VISION, { pdf: true }], [secondVision, { pdf: true }], [TEXT, { pdf: false }]]);
    const attempts = vi.fn(async () => {
      const response = new Response("denied", { status: 403 });
      response[LOCAL_POLICY_REJECTION] = true;
      return response;
    });
    const handle = (sent) => handleComboChat({
      body: sent, models: [VISION, TEXT], handleSingleModel: attempts,
      capabilitiesMap: pdfCaps, comboStrategy: "fallback", comboName: "inner-pdf", log,
    });
    const res = await run(body, handle, { models, capabilitiesMap: pdfCaps });
    expect(res.status).toBe(403);
    expect(attempts.mock.calls.map(([, model]) => model)).toEqual(models.map(() => VISION));
    for (const [sent] of attempts.mock.calls) expect(sent.messages.slice(2)).toEqual([
      { role: "tool", tool_call_id: "call_1", content: [{ type: "text", text: "[tool returned media; see attached]" }] },
      { role: "user", content: [pdf] },
    ]);
  });

  it("keeps legacy panel flattening when autoSwitch is off", async () => {
    const handle = vi.fn(async () => ok());
    await run(BODIES.chatTool, handle, { autoSwitch: false });
    expect(handle.mock.calls.map(([, model]) => model)).toEqual([TEXT, VISION, secondVision, TEXT]);
    for (const [sent, , isPanel] of handle.mock.calls) {
      if (isPanel) {
        expect(sent.messages.some((message) => message.role === "tool" || message.tool_calls)).toBe(false);
      }
    }
  });

  it("returns generic 403 only when every capable panel member has an internal policy rejection", async () => {
    const handle = vi.fn(async () => {
      const res = Response.json({ error: { message: "private model name" } }, { status: 403 });
      res[LOCAL_POLICY_REJECTION] = true;
      return res;
    });
    const res = await run(BODIES.chatTool, handle);
    expect(res.status).toBe(403);
    expect(await res.text()).not.toContain("private model name");
    expect(handle.mock.calls.map(([, model]) => model)).toEqual([VISION, secondVision]);
  });

  it("does not interpret upstream 403 as local policy denial", async () => {
    const handle = vi.fn(async () => new Response("upstream forbidden", { status: 403 }));
    expect((await run(BODIES.chatTool, handle)).status).toBe(503);
  });

  it.each([
    ["unanimous policy denial", null, 403],
    ["upstream 403", 403, 503],
    ["quota rejection", 429, 503],
    ["timeout", "timeout", 503],
  ])("classifies nested multi-member fallback with %s", async (_name, otherFailure, expectedStatus) => {
    const handle = (body) => handleComboChat({
      body, models: [VISION, secondVision], capabilitiesMap: fusionCaps,
      log, comboName: "nested", comboStrategy: "fallback",
      handleSingleModel: async (_body, model) => {
        if (model === VISION || otherFailure === null) {
          const response = new Response("denied", { status: 403 });
          response[LOCAL_POLICY_REJECTION] = true;
          return response;
        }
        if (otherFailure === "timeout") {
          const error = new Error("nested timeout");
          error.isComboTimeout = true;
          throw error;
        }
        return Response.json({ error: { message: "upstream failure" } }, { status: otherFailure });
      },
    });
    expect((await run(BODIES.chatTool, handle)).status).toBe(expectedStatus);
  });

  it("does not interpret a drained timeout beside a policy rejection as all-denied", async () => {
    const handle = vi.fn(async (_body, model, _isPanel, signal) => {
      if (model === secondVision) return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      });
      const response = new Response("denied", { status: 403 });
      response[LOCAL_POLICY_REJECTION] = true;
      return response;
    });
    const res = await run(BODIES.chatTool, handle, { tuning: { panelHardTimeoutMs: 20 } });
    expect(res.status).toBe(503);
    expect(handle).toHaveBeenCalledTimes(2);
  });

  it("aborts and drains a capable straggler before media reaches the judge", async () => {
    let cleaned = false;
    const handle = vi.fn(async (_body, model, isPanel, signal) => {
      if (isPanel && model === secondVision) return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          cleaned = true;
          reject(new DOMException("aborted", "AbortError"));
        }, { once: true });
      });
      if (!isPanel) expect(cleaned).toBe(true);
      return ok();
    });
    const res = await run(BODIES.chatTool, handle, {
      judgeModel: VISION,
      tuning: { minPanel: 1, stragglerGraceMs: 1, panelHardTimeoutMs: 100 },
    });
    expect(res.status).toBe(200);
    expect(cleaned).toBe(true);
    expect(handle.mock.calls.map(([, model]) => model)).toEqual([VISION, secondVision, VISION]);
    expect(handle.mock.calls.at(-1)[0].messages.slice(0, 4)).toEqual(CHAT_TOOL_DISPATCH.messages);
  });

  it("uses an allowed survivor without replaying denied members", async () => {
    const handle = vi.fn(async (_body, model) => {
      if (model === VISION) {
        const res = new Response("denied", { status: 403 });
        res[LOCAL_POLICY_REJECTION] = true;
        return res;
      }
      return ok();
    });
    expect((await run(BODIES.chatTool, handle)).status).toBe(200);
    expect(handle.mock.calls.map(([, model]) => model)).toEqual([VISION, secondVision, secondVision]);
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
