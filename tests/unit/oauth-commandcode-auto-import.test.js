import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  local: vi.fn(),
  origin: vi.fn(),
  operator: vi.fn(),
  open: vi.fn(),
  createProvider: vi.fn()
}));

vi.mock("@/dashboardGuard", () => ({
  isLocalRequest: mocks.local,
  hasExactRequestOrigin: mocks.origin,
  isOperatorRequest: mocks.operator
}));
vi.mock("@/lib/providerRouteHandlers", () => ({ createProvider: mocks.createProvider }));
vi.mock("node:fs/promises", () => ({ open: mocks.open }));

import { POST } from "@/app/api/oauth/commandcode/auto-import/route.js";

const request = () => new Request("http://localhost:20128/api/oauth/commandcode/auto-import", {
  method: "POST", body: JSON.stringify({ name: "Imported CLI", proxyPoolId: "pool" })
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.local.mockReturnValue(true);
  mocks.origin.mockReturnValue(true);
  mocks.operator.mockResolvedValue(true);
});

describe("Command Code CLI import", () => {
  it.each(["local", "origin", "operator"])("rejects failure of the %s check before opening the file", async (check) => {
    mocks[check].mockReturnValue(false);
    expect((await POST(request())).status).toBe(403);
    expect(mocks.open).not.toHaveBeenCalled();
  });

  it("stores the key with normal connection creation and returns only sanitized metadata", async () => {
    const source = Buffer.from(JSON.stringify({ apiKey: "user_example" }));
    mocks.open.mockResolvedValue({
      stat: async () => ({ isFile: () => true, size: source.length }),
      read: async (buffer) => ({ bytesRead: source.copy(buffer) }),
      close: async () => {},
    });
    mocks.createProvider.mockImplementation(async (input) => {
      expect(await input.json()).toEqual({
        provider: "commandcode", apiKey: "user_example", name: "Imported CLI", proxyPoolId: "pool", createOnly: true
      });
      return Response.json({ connection: { id: "connection" } }, { status: 201 });
    });
    const response = await POST(request());
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ connection: { id: "connection" } });
  });
});
