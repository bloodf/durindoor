import { afterEach, describe, expect, it, vi } from "vitest";
import { GitHubService } from "../../src/lib/oauth/services/github.js";
import gheCopilot from "../../src/lib/oauth/gheCopilotProvider.js";

vi.mock("open", () => ({ default: vi.fn() }));

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe("Copilot sign-in boundaries", () => {
  it.each(["getDeviceCode", "getCopilotToken", "getUserInfo"])("does not expose the %s upstream body", async (method) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("synthetic-secret", { status: 401 }));
    await expect(new GitHubService()[method]("synthetic-token")).rejects.toThrow(/HTTP 401/);
    try { await new GitHubService()[method]("synthetic-token"); } catch (error) {
      expect(error.message).not.toContain("synthetic-secret");
    }
  });

  it("keeps concurrent enterprise device requests bound to their hosts and proxies", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) =>
      Response.json({ device_code: new URL(url).hostname }));
    const proxies = [{ id: "a" }, { id: "b" }];
    const results = await Promise.all(["a", "b"].map((id, i) =>
      gheCopilot.requestDeviceCode({ clientId: `client-${id}`, scopes: "read:user" }, null,
        { gheUrl: `https://${id}.example.test` }, proxies[i])));
    expect(results.map((result) => result._gheUrl)).toEqual(["https://a.example.test", "https://b.example.test"]);
    for (const [i, id] of ["a", "b"].entries()) {
      expect(fetchMock.mock.calls[i][1].proxyOptions).toBe(proxies[i]);
      expect(fetchMock.mock.calls[i][1].body.get("client_id")).toBe(`client-${id}`);
    }
  });

  it("rejects a non-HTTPS enterprise host before network access", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    await expect(gheCopilot.requestDeviceCode({}, null, { gheUrl: "http://example.test" })).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("CLI device polling", () => {
  it("honors slow_down and stops after an accepted token", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "log").mockImplementation(() => {});
    const transport = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ error: "slow_down" }))
      .mockResolvedValueOnce(Response.json({ access_token: "synthetic-oauth", token_type: "bearer" }));
    const result = new GitHubService().pollAccessToken("device", "https://github.com/login/device", "code", 1000, 30);
    const assertion = expect(result).resolves.toMatchObject({ access_token: "synthetic-oauth" });
    await vi.advanceTimersByTimeAsync(1000);
    expect(transport).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(6000);
    await assertion;
    await vi.advanceTimersByTimeAsync(20000);
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it("expires before a poll would occur after the deadline", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "log").mockImplementation(() => {});
    const transport = vi.spyOn(globalThis, "fetch");
    await expect(new GitHubService().pollAccessToken("device", "https://github.com/login/device", "code", 1000, 1)).rejects.toThrow("Device code expired");
    expect(transport).not.toHaveBeenCalled();
  });

  it("can abort while waiting without submitting", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "log").mockImplementation(() => {});
    const transport = vi.spyOn(globalThis, "fetch");
    const controller = new AbortController();
    const result = new GitHubService().pollAccessToken("device", "https://github.com/login/device", "code", 1000, 30, controller.signal);
    const assertion = expect(result).rejects.toThrow("cancelled");
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await assertion;
    expect(transport).not.toHaveBeenCalled();
  });
});

describe("enterprise poll transport", () => {
  it("does not follow redirects or return malformed upstream bodies", async () => {
    const transport = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("synthetic-secret", { status: 302, headers: { location: "https://other.example.test" } }));
    const result = await gheCopilot.pollToken({ clientId: "synthetic-client" }, "device", null, { _gheUrl: "https://tenant.example.test" }, { id: "proxy" });
    expect(result).toEqual({ ok: false, data: { error: "invalid_response" } });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0][1]).toMatchObject({ redirect: "manual", proxyOptions: { id: "proxy" } });
  });
});

describe("staged web decoder", () => {
  it("retains device state while suppressing unknown upstream text", async () => {
    const { decodeCopilotPollResponse } = await import("../../src/lib/oauth/providerParity/copilot/index.js");
    expect(decodeCopilotPollResponse('{"error":"slow_down","error_description":"synthetic-secret"}')).toEqual({ error: "slow_down" });
    expect(decodeCopilotPollResponse("synthetic-secret")).toEqual({ error: "invalid_response" });
    expect(decodeCopilotPollResponse('{"access_token":"synthetic-token"}')).toEqual({ access_token: "synthetic-token" });
  });
});

describe("CLI device response", () => {
  it("rejects an untrusted browser URL before opening it", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ device_code: "device", user_code: "code", verification_uri: "https://other.example.test/", expires_in: 300, interval: 5 }));
    await expect(new GitHubService().getDeviceCode()).rejects.toThrow("Invalid GitHub device response");
  });
});
