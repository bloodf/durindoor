import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "../../src/app/api/providers/validate/route.js";

vi.mock("next/server", () => ({
  NextResponse: {
    json: (data, init = {}) => ({
      status: init.status || 200,
      json: async () => data,
    }),
  },
}));

describe("provider validation auth descriptors", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses MariTalk's raw key header during generic validation", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
    });

    const response = await POST({
      json: async () => ({ provider: "maritalk", apiKey: "mt-test-key" }),
    });
    const payload = await response.json();

    expect(payload).toEqual({ valid: true, error: null });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://chat.maritaca.ai/api/models",
      expect.objectContaining({
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          key: "mt-test-key",
        }),
      }),
    );
  });
});
