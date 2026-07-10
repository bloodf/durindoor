import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handleChat: vi.fn(),
  initTranslators: vi.fn(async () => undefined),
}));

vi.mock("@/sse/handlers/chat.js", () => ({
  handleChat: mocks.handleChat,
}));

vi.mock("open-sse/translator/index.js", () => ({
  initTranslators: mocks.initTranslators,
}));

const { POST } = await import("../../src/app/api/v1/responses/compact/route.js");

describe("Codex compact Responses route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.handleChat.mockResolvedValue(new Response("ok"));
  });

  it("passes the original Request through without injecting an internal body marker", async () => {
    const body = { model: "cx/gpt-5.3-codex", input: "compact this" };
    const request = new Request("https://router.test/v1/responses/compact", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-session-id": "session-a",
      },
      body: JSON.stringify(body),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(mocks.handleChat).toHaveBeenCalledWith(request);
    expect(await request.clone().json()).toEqual(body);
    expect(await request.clone().json()).not.toHaveProperty("_compact");
  });
});
