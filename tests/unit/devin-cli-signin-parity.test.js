import { EventEmitter } from "node:events";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
import { spawn } from "node:child_process";
import { getExecutor } from "../../open-sse/executors/index.js";
import { generateAuthData, getProvider } from "../../src/lib/oauth/providers.js";

function childFixture() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { destroyed: false, write: vi.fn(), end: vi.fn() };
  child.kill = vi.fn();
  return child;
}
function receive(child, message) { child.stdout.emit("data", Buffer.from(`${JSON.stringify(message)}\n`)); }
function sent(child) { return child.stdin.write.mock.calls.map(([line]) => JSON.parse(line)); }
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks(); });

it("imports separate credentials and speaks the current ACP prompt and streaming contract", async () => {
  const fetcher = vi.fn(() => { throw new Error("unexpected outbound request"); });
  vi.stubGlobal("fetch", fetcher);
  vi.stubEnv("CLI_DEVIN_BIN", "/fixture/devin");
  vi.stubEnv("WINDSURF_API_KEY", "fixture-ambient");
  expect(await generateAuthData("devin-cli", "http://localhost/callback")).toMatchObject({ flowType: "import_token", authUrl: null });
  const provider = getProvider("devin-cli");
  const tokens = ["fixture-one", "fixture-two"].map((token) => provider.mapTokens({ token }));
  expect(tokens.map((token) => token.accessToken)).toEqual(["fixture-one", "fixture-two"]);
  const children = [childFixture(), childFixture()];
  spawn.mockReturnValueOnce(children[0]).mockReturnValueOnce(children[1]);
  const results = await Promise.all(tokens.map((credentials, i) => getExecutor("devin-cli").execute({
    model: "fixture-model", credentials, body: { messages: [{ role: "user", content: `hello ${i}` }] },
  })));
  expect(spawn.mock.calls.map((call) => call[2].env.WINDSURF_API_KEY)).toEqual(["fixture-one", "fixture-two"]);
  for (const [i, child] of children.entries()) {
    receive(child, { id: 1, result: {} });
    expect(sent(child)[1]).toMatchObject({ method: "session/new", params: { mcpServers: [], model: "fixture-model" } });
    receive(child, { id: 2, result: { sessionId: `session-${i}` } });
    expect(sent(child)[2]).toMatchObject({ method: "session/prompt", params: { sessionId: `session-${i}`, prompt: [{ type: "text", text: `[User]\nhello ${i}` }] } });
    expect(sent(child)[2].params).not.toHaveProperty("content");
    receive(child, { method: "session/update", params: { sessionId: `session-${i}`, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: `answer ${i}` } } } });
    receive(child, { id: 3, result: { stopReason: "end_turn" } });
  }
  for (const [i, result] of results.entries()) {
    const output = await result.response.text();
    expect(output).toContain(`answer ${i}`);
    expect(output).not.toContain(`answer ${1 - i}`);
    expect(output).toContain("[DONE]");
  }
  expect(fetcher).not.toHaveBeenCalled();
});
