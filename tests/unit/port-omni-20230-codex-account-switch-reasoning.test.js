// OmniRoute #20230: reasoning ciphertext does not follow a request to another Codex account.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const transport = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("../../open-sse/utils/proxyFetch.js", async (original) => ({ ...(await original()), proxyAwareFetch: transport.fetch }));

const originalDataDir = process.env.DATA_DIR;
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-codex-20230-"));
let db;
let handleChat;

beforeAll(async () => {
  process.env.DATA_DIR = tempDir;
  vi.stubGlobal("fetch", transport.fetch);
  db = await import("../../src/lib/db/index.js");
  await db.initDb();
  await db.updateSettings({ requireApiKey: false });
  for (const [name, priority] of [["first", 1], ["second", 2]]) {
    await db.createProviderConnection({ provider: "codex", authType: "apikey", apiKey: `synthetic-${name}`, name, priority });
  }
  ({ handleChat } = await import("../../src/sse/handlers/chat.js"));
});

afterAll(() => {
  vi.unstubAllGlobals();
  fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

const completed = () => {
  const response = { id: "resp_1", object: "response", status: "completed", model: "gpt-5.4", output: [{ type: "message", id: "msg_1", role: "assistant", content: [{ type: "output_text", text: "ok" }] }], usage: { input_tokens: 3, output_tokens: 1, total_tokens: 4 } };
  return new Response(`event: response.completed\ndata: ${JSON.stringify({ type: "response.completed", response })}\n\n`, { headers: { "content-type": "text/event-stream" } });
};

describe("port(omniroute): #20230 Codex account rotation drops reasoning ciphertext", () => {
  it("keeps it for the first account and never sends it to the second", async () => {
    const sent = [];
    transport.fetch.mockImplementation(async (_url, options) => {
      sent.push(String(options.body));
      return sent.length === 1
        ? Response.json({ error: { type: "usage_limit_reached", message: "The usage limit has been reached" } }, { status: 429 })
        : completed();
    });
    const result = await handleChat(new Request("http://localhost/v1/responses", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "codex/gpt-5.4", stream: true, store: false,
        input: [
          { type: "message", role: "user", content: [{ type: "input_text", text: "one" }] },
          { type: "reasoning", id: "rs_0123abc", summary: [{ type: "summary_text", text: "kept summary" }], encrypted_content: "FIRST-ACCOUNT-CIPHERTEXT" },
          { type: "message", role: "user", content: [{ type: "input_text", text: "two" }] }
        ]
      })
    }));
    expect(result.status).toBe(200);
    await result.text();
    expect(sent).toHaveLength(2);
    expect(sent[0]).toContain("FIRST-ACCOUNT-CIPHERTEXT");
    expect(sent[1]).not.toContain("FIRST-ACCOUNT-CIPHERTEXT");
    expect(sent[1]).toContain("kept summary");
  });
});
