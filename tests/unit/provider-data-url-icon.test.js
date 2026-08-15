import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_PROVIDER_ICON_DATA_BYTES, isValidProviderIconUrl } from "../../src/shared/utils/providerIcon.js";

const model = vi.hoisted(() => ({
  createProviderNode: vi.fn(), getProviderNodes: vi.fn(), getProviderNodeById: vi.fn(),
  updateProviderNode: vi.fn(), deleteProviderNode: vi.fn(), getProviderConnections: vi.fn(),
  updateProviderConnection: vi.fn(), deleteProviderConnectionsByProvider: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: { json: (body, init = {}) => new Response(JSON.stringify(body), { status: init.status || 200 }) },
}));
vi.mock("@/models", () => model);
vi.mock("@/shared/utils", () => ({ generateId: () => "test" }));

const { POST } = await import("../../src/app/api/provider-nodes/route.js");
const { PUT } = await import("../../src/app/api/provider-nodes/[id]/route.js");

const png = "data:image/png;base64,iVBORw0KGgo=";
const oversizedPng = `data:image/png;base64,${Buffer.alloc(MAX_PROVIDER_ICON_DATA_BYTES + 1).toString("base64")}`;
const nodeId = "openai-compatible-chat-test";

function request(body, method = "POST") {
  return new Request(`http://localhost/api/provider-nodes/${method === "PUT" ? nodeId : ""}`, {
    method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}

function node(iconUrl) {
  return {
    name: "Node", prefix: "node/", apiType: "chat", baseUrl: "https://api.example/v1",
    type: "openai-compatible", ...(iconUrl === undefined ? {} : { iconUrl }),
  };
}

describe("isValidProviderIconUrl", () => {
  it("accepts explicit empty clearing and bounded raster/HTTP sources", () => {
    expect(isValidProviderIconUrl("")).toBe(true);
    expect(isValidProviderIconUrl(png)).toBe(true);
    expect(isValidProviderIconUrl("https://icons.example/logo.png")).toBe(true);
  });

  it("rejects unsafe schemes, non-images, SVG, malformed, and non-canonical base64", () => {
    for (const iconUrl of [
      null, 42, {}, "javascript:alert(1)", "file:///etc/passwd",
      "https://icons.example/" + "x".repeat(2001), "data:text/html;base64,PHNjcmlwdD4=",
      "data:image/png,not-base64", "data:image/png;base64,%%%",
      "data:image/png;base64,AB==", "data:image/png;base64,AAB=",
      "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
    ]) expect(isValidProviderIconUrl(iconUrl)).toBe(false);
  });

  it("rejects encoded and decoded payloads over the bound", () => {
    expect(isValidProviderIconUrl(oversizedPng)).toBe(false);
    expect(isValidProviderIconUrl(`data:image/png;base64,${"A".repeat(MAX_PROVIDER_ICON_DATA_BYTES * 2)}`)).toBe(false);
  });
});

describe("provider-node icon persistence boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    model.getProviderNodeById.mockResolvedValue({ id: nodeId, type: "openai-compatible" });
    model.getProviderConnections.mockResolvedValue([]);
  });

  it.each([
    ["POST script URL", () => POST(request(node("javascript:alert(1)")))],
    ["POST oversized data URL", () => POST(request(node(oversizedPng)))],
    ["PUT SVG data URL", () => PUT(request(node("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="), "PUT"), { params: Promise.resolve({ id: nodeId }) })],
  ])("%s returns 400 before any persistence write", async (_name, call) => {
    const response = await call();
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid icon URL" });
    expect(model.createProviderNode).not.toHaveBeenCalled();
    expect(model.updateProviderNode).not.toHaveBeenCalled();
  });

  it("POST persists valid trimmed HTTP icon", async () => {
    model.createProviderNode.mockResolvedValue({ id: nodeId });
    const response = await POST(request(node("  https://icons.example/logo.png  ")));
    expect(response.status).toBe(201);
    expect(model.createProviderNode).toHaveBeenCalledWith(expect.objectContaining({ iconUrl: "https://icons.example/logo.png" }));
  });

  it("PUT persists valid bounded data icon", async () => {
    model.updateProviderNode.mockResolvedValue({ id: nodeId });
    const response = await PUT(request(node(png), "PUT"), { params: Promise.resolve({ id: nodeId }) });
    expect(response.status).toBe(200);
    expect(model.updateProviderNode).toHaveBeenCalledWith(nodeId, expect.objectContaining({ iconUrl: png }));
  });

  it.each([
    ["POST", () => POST(request(node(""))), () => model.createProviderNode, 0],
    ["PUT", () => PUT(request(node(""), "PUT"), { params: Promise.resolve({ id: nodeId }) }), () => model.updateProviderNode, 1],
  ])("%s persists explicit empty iconUrl to clear custom icon", async (_name, call, writer, index) => {
    model.createProviderNode.mockResolvedValue({ id: nodeId });
    model.updateProviderNode.mockResolvedValue({ id: nodeId });
    const response = await call();
    expect(response.status).toBeLessThan(300);
    expect(writer().mock.calls[0][index]).toEqual(expect.objectContaining({ iconUrl: "" }));
  });

  it("PUT omits iconUrl from updates when the field is not supplied", async () => {
    model.updateProviderNode.mockResolvedValue({ id: nodeId });
    const response = await PUT(request(node(), "PUT"), { params: Promise.resolve({ id: nodeId }) });
    expect(response.status).toBe(200);
    expect(model.updateProviderNode.mock.calls[0][1]).not.toHaveProperty("iconUrl");
  });
});
