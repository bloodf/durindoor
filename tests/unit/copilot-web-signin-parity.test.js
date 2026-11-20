import { afterEach, describe, expect, it, vi } from "vitest";
import { CopilotWebExecutor, __setCopilotWebSocketForTesting } from "../../open-sse/executors/copilot-web.js";
import { CopilotM365WebExecutor, __setCopilotM365WebSocketForTesting } from "../../open-sse/executors/copilot-m365-web.js";
import { __setOriginalFetchForTesting } from "../../open-sse/utils/proxyFetch.js";

const sockets = [];
class FakeSocket {
  constructor(url, options) { this.url = url; this.options = options; this.handlers = {}; sockets.push(this); queueMicrotask(() => this.emit("open")); }
  on(name, fn) { this.handlers[name] = fn; }
  emit(name, value) { this.handlers[name]?.(value); }
  send(data) {
    const text = String(data);
    const frame = JSON.parse(text.replace(/\x1e$/, ""));
    if (frame.event === "send") queueMicrotask(() => { this.emit("message", JSON.stringify({ event: "appendText", text: "personal" })); this.emit("message", JSON.stringify({ event: "done" })); });
    if (frame.protocol) queueMicrotask(() => this.emit("message", Buffer.from("{}\x1e")));
    if (frame.target === "chat") queueMicrotask(() => this.emit("message", Buffer.from('{"type":1,"target":"update","arguments":[{"messages":[{"author":"bot","text":"tenant"}]}]}\x1e{"type":3}\x1e')));
  }
  close() {}
}
const input = { body: { messages: [{ role: "user", content: "hello" }] }, stream: true };
let restores = [];
afterEach(() => { restores.reverse().forEach((fn) => fn()); restores = []; sockets.length = 0; });

describe("Copilot web session request parity", () => {
  it("extracts structured personal credentials and keeps tenant credentials on their own transport", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ conversationId: "synthetic-conversation" })));
    restores.push(__setOriginalFetchForTesting(fetchMock), __setCopilotWebSocketForTesting(FakeSocket), __setCopilotM365WebSocketForTesting(FakeSocket));
    const personal = await new CopilotWebExecutor().execute({ ...input, credentials: { apiKey: '{"access_token":"personal-token"}' } });
    expect(await personal.response.text()).toContain("personal");
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer personal-token");
    expect(sockets[0].options.headers.Authorization).toBe("Bearer personal-token");
    const tenant = await new CopilotM365WebExecutor().execute({ ...input, credentials: { apiKey: "access_token=tenant-token; chathubPath=user@tenant" } });
    expect(await tenant.response.text()).toContain("tenant");
    const tenantUrl = new URL(sockets[1].url);
    expect(tenantUrl.hostname).toBe("substrate.office.com");
    expect(tenantUrl.searchParams.get("access_token")).toBe("tenant-token");
    expect(sockets[1].url).not.toContain("personal-token");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("rejects a cookie without a personal access token before outbound requests", async () => {
    const fetchMock = vi.fn(() => { throw new Error("unexpected outbound request"); });
    restores.push(__setOriginalFetchForTesting(fetchMock), __setCopilotWebSocketForTesting(FakeSocket));
    const result = await new CopilotWebExecutor().execute({ ...input, credentials: { apiKey: "session=unrelated; theme=dark" } });
    expect(result.response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sockets).toHaveLength(0);
  });
  it("uses only personal-origin credentials from a HAR and rejects a foreign-only HAR", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ conversationId: "synthetic" })));
    restores.push(__setOriginalFetchForTesting(fetchMock), __setCopilotWebSocketForTesting(FakeSocket));
    const entry = (url, token) => ({ request: { url, headers: [{ name: "Cookie", value: `access_token=${token}` }] } });
    const har = JSON.stringify({ log: { entries: [entry("https://attacker.example/", "foreign"), entry("https://copilot.microsoft.com/c/api/start", "own")] } });
    const result = await new CopilotWebExecutor().execute({ ...input, credentials: { apiKey: har } });
    await result.response.text();
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer own");
    const rejected = await new CopilotWebExecutor().execute({ ...input, credentials: { apiKey: JSON.stringify({ log: { entries: [entry("https://copilot.microsoft.com.attacker.example/", "foreign")] } }) } });
    expect(rejected.response.status).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("reports rewritten Microsoft 365 snapshots rather than concatenating conflicting text", async () => {
    class RewriteSocket extends FakeSocket {
      send(data) {
        const frame = JSON.parse(String(data).replace(/\x1e$/, ""));
        if (frame.protocol) queueMicrotask(() => this.emit("message", Buffer.from("{}\x1e")));
        if (frame.target === "chat") queueMicrotask(() => this.emit("message", Buffer.from('{"type":1,"target":"update","arguments":[{"messages":[{"author":"bot","text":"old"}]}]}\x1e{"type":1,"target":"update","arguments":[{"messages":[{"author":"bot","text":"new"}]}]}\x1e{"type":3}\x1e')));
      }
    }
    restores.push(__setCopilotM365WebSocketForTesting(RewriteSocket));
    const credentials = { apiKey: "access_token=tenant-token; chathubPath=user@tenant" };
    const streamed = await new CopilotM365WebExecutor().execute({ ...input, credentials });
    const text = await streamed.response.text();
    expect(text).toContain("rewrote");
    expect(text).not.toContain('"content":"new"');
    const buffered = await new CopilotM365WebExecutor().execute({ ...input, credentials, stream: false });
    expect((await buffered.response.json()).choices[0].message.content).toBe("new");
  });
  it("uses the work profile only for a tenant configured for it", async () => {
    restores.push(__setCopilotM365WebSocketForTesting(FakeSocket));
    const credential = (token, path, tier) => ({ apiKey: `access_token=${token}; chathubPath=${path}`, providerSpecificData: { tier } });
    const work = await new CopilotM365WebExecutor().execute({ ...input, credentials: credential("work-token", "work@tenant", "work") });
    await work.response.text();
    const individual = await new CopilotM365WebExecutor().execute({ ...input, credentials: credential("individual-token", "person@consumer", "") });
    await individual.response.text();
    const workUrl = new URL(sockets[0].url);
    const individualUrl = new URL(sockets[1].url);
    expect(workUrl.searchParams.get("agent")).toBe("work");
    expect(workUrl.searchParams.get("scenario")).toBe("officeweb");
    expect(workUrl.searchParams.get("licenseType")).toBe("Premium");
    expect(individualUrl.searchParams.get("agent")).toBe("web");
    expect(individualUrl.searchParams.get("access_token")).toBe("individual-token");
    expect(individualUrl.pathname).toContain("person@consumer");
  });
  it("does not reuse another personal session after an expired credential is rejected", async () => {
    const fetchMock = vi.fn(async (_url, options) => options.headers.Authorization === "Bearer expired-token" ?
      new Response("expired", { status: 401 }) : new Response(JSON.stringify({ conversationId: "new-thread" })));
    restores.push(__setOriginalFetchForTesting(fetchMock), __setCopilotWebSocketForTesting(FakeSocket));
    const fresh = await new CopilotWebExecutor().execute({ ...input, credentials: { apiKey: "fresh-token" } });
    await fresh.response.text();
    const expired = await new CopilotWebExecutor().execute({ ...input, credentials: { apiKey: "expired-token" } });
    expect(expired.response.status).toBe(401);
    expect(fetchMock.mock.calls.map((call) => call[1].headers.Authorization)).toEqual(["Bearer fresh-token", "Bearer expired-token"]);
    expect(sockets).toHaveLength(1);
  });
  it("rejects structured credentials explicitly bound to another origin", async () => {
    const fetchMock = vi.fn(() => { throw new Error("unexpected outbound request"); });
    restores.push(__setOriginalFetchForTesting(fetchMock), __setCopilotWebSocketForTesting(FakeSocket));
    const result = await new CopilotWebExecutor().execute({ ...input, credentials: { apiKey: '{"access_token":"foreign","origin":"https://attacker.example"}' } });
    expect(result.response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
