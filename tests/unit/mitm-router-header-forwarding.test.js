import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  fetchRouter,
  selectForwardedClientHeaders,
} = require("../../src/mitm/handlers/base.js");

describe("MITM router header forwarding", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses a harmless metadata allowlist", () => {
    expect(selectForwardedClientHeaders({
      Accept: "text/event-stream",
      "User-Agent": "client/1",
      "Anthropic-Beta": "interleaved-thinking-2025-05-14",
      "Anthropic-Version": "2023-06-01",
      "OpenAI-Intent": "conversation-panel",
      "X-App": "cli",
      "X-Initiator": "user",
      "X-DurinDoor-Token-Saver": "off",
      "X-9Router-Token-Saver": "off",
      Cookie: "sid=secret",
      Authorization: "Bearer upstream",
      "Proxy-Authorization": "Basic secret",
      "X-Api-Key": "provider-secret",
      "X-Goog-Api-Key": "google-secret",
      "X-Amz-Security-Token": "aws-secret",
      "X-Custom-Token": "other-secret",
    })).toEqual({
      Accept: "text/event-stream",
      "User-Agent": "client/1",
      "Anthropic-Beta": "interleaved-thinking-2025-05-14",
      "Anthropic-Version": "2023-06-01",
      "OpenAI-Intent": "conversation-panel",
      "X-App": "cli",
      "X-Initiator": "user",
      "X-DurinDoor-Token-Saver": "off",
      "X-9Router-Token-Saver": "off",
    });
  });

  it("does not put intercepted credentials on the router fetch", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchRouter({ model: "test" }, "/v1/chat/completions", {
      Accept: "text/event-stream",
      "Anthropic-Beta": "interleaved-thinking-2025-05-14",
      "Anthropic-Version": "2023-06-01",
      "OpenAI-Intent": "conversation-panel",
      "X-App": "cli",
      "X-Initiator": "user",
      "X-DurinDoor-Token-Saver": "off",
      "X-9Router-Token-Saver": "off",
      Cookie: "sid=secret",
      Authorization: "Bearer upstream",
      "X-Api-Key": "provider-secret",
      "X-Goog-Api-Key": "google-secret",
      "X-Amz-Security-Token": "aws-secret",
    });

    const headers = fetchMock.mock.calls[0][1].headers;
    expect(headers.Accept).toBe("text/event-stream");
    expect(headers["Anthropic-Beta"]).toBe("interleaved-thinking-2025-05-14");
    expect(headers["Anthropic-Version"]).toBe("2023-06-01");
    expect(headers["OpenAI-Intent"]).toBe("conversation-panel");
    expect(headers["X-App"]).toBe("cli");
    expect(headers["X-Initiator"]).toBe("user");
    expect(headers.Cookie).toBeUndefined();
    expect(headers["X-Api-Key"]).toBeUndefined();
    expect(headers["X-Goog-Api-Key"]).toBeUndefined();
    expect(headers["X-Amz-Security-Token"]).toBeUndefined();
    expect(headers.Authorization).toBeUndefined();
    expect(headers["X-DurinDoor-Token-Saver"]).toBe("off");
    expect(headers["X-9Router-Token-Saver"]).toBe("off");
  });
});
