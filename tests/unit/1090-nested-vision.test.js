import { describe, expect, it, vi } from "vitest";
import {
  comboPolicyRejection,
  detectToolOutputCapabilities,
  handleComboChat,
  handleFusionChat,
} from "../../open-sse/services/combo.js";

const textModel = "fixture/text";
const visionModel = "fixture/vision";
const imageUrl = "data:image/png;base64,iVBORw0KGgo=";
const image = { type: "input_image", image_url: imageUrl };
const capabilitiesMap = new Map([
  [textModel, { vision: false }],
  [visionModel, { vision: true }],
]);
const log = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() };

function route(body, handleSingleModel, models = [textModel, visionModel]) {
  return handleComboChat({
    body, handleSingleModel, models, log, capabilitiesMap,
    comboName: "fixture", comboStrategy: "fallback", checkEmptyBody: false,
  });
}

const fixtures = {
  "Claude tool result": {
    messages: [
      { role: "assistant", content: [{ type: "tool_use", id: "shot", name: "capture", input: {} }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "shot", content: [
        { type: "image", source: { type: "url", url: "https://example.invalid/shot.png" } },
      ] }] },
    ],
  },
  "Responses function output": {
    input: [
      { type: "function_call", call_id: "shot", name: "capture", arguments: "{}" },
      { type: "function_call_output", call_id: "shot", output: [image] },
    ],
  },
  "Responses custom output": {
    input: [
      { type: "custom_tool_call", call_id: "shot", name: "capture", input: "" },
      { type: "custom_tool_call_output", call_id: "shot", output: [image] },
    ],
  },
  "Responses role-based output": {
    input: [{ role: "tool", tool_call_id: "shot", content: [image] }],
  },
};

describe("#1090 combo vision admission", () => {
  it.each(Object.entries(fixtures))("only dispatches %s to vision and preserves IDs and media", async (_label, fixture) => {
    const body = structuredClone(fixture);
    const dispatch = vi.fn(async () => new Response("ok"));

    expect(detectToolOutputCapabilities(body)).toEqual(new Set(["vision"]));
    expect((await route(body, dispatch)).status).toBe(200);
    expect(dispatch.mock.calls.map(([sent, model]) => [sent, model])).toEqual([[fixture, visionModel]]);
  });

  it.each(Object.entries(fixtures))("rejects %s before dispatch with a text-only pool", async (_label, body) => {
    const dispatch = vi.fn();

    const response = await route(body, dispatch, [textModel]);
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("capability_unavailable");
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("keeps the first text member for text-only Responses output", async () => {
    const body = { input: [{ type: "custom_tool_call_output", call_id: "shot", output: "No image captured" }] };
    const dispatch = vi.fn(async () => new Response("ok"));

    expect((await route(body, dispatch)).status).toBe(200);
    expect(dispatch.mock.calls.map(([, model]) => model)).toEqual([textModel]);
  });

  it("returns a capability error without a text fallback when local policy rejects vision", async () => {
    const dispatch = vi.fn(async () => comboPolicyRejection());

    const response = await route(fixtures["Responses custom output"], dispatch);
    expect(response.status).toBe(403);
    expect((await response.json()).error).toMatchObject({
      code: "capability_unavailable",
      message: "Access denied",
    });
    expect(dispatch.mock.calls.map(([, model]) => model)).toEqual([visionModel]);
  });

  it("keeps the generic denial when a single capable fusion panel member is denied", async () => {
    const dispatch = vi.fn(async () => comboPolicyRejection());
    const response = await handleFusionChat({
      body: fixtures["Responses function output"],
      models: [textModel, visionModel],
      handleSingleModel: dispatch,
      log,
      capabilitiesMap,
      comboName: "fixture",
    });

    expect(response.status).toBe(403);
    expect((await response.json()).error).toMatchObject({
      code: "capability_unavailable",
      message: "Access denied",
    });
    expect(dispatch.mock.calls.map(([, model]) => model)).toEqual([visionModel]);
  });

  it("preserves an upstream 403 as a provider failure", async () => {
    const dispatch = vi.fn(async () => Response.json({ error: { message: "Forbidden" } }, { status: 403 }));

    const response = await route(fixtures["Responses function output"], dispatch);
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBeUndefined();
    expect(dispatch.mock.calls.map(([, model]) => model)).toEqual([visionModel]);
  });
});
