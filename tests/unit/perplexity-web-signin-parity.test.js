import { afterEach, expect, it, vi } from "vitest";
import { PerplexityWebExecutor } from "../../open-sse/executors/perplexity-web.js";

const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; });

it("keeps continuation identifiers scoped to the supplied web session", async () => {
  const requests = [];
  global.fetch = vi.fn(async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return new Response(`data: ${JSON.stringify({ backend_uuid: "fake-thread", text: "answer", status: "COMPLETED" })}\n\ndata: [DONE]\n\n`);
  });
  const executor = new PerplexityWebExecutor();
  const first = [{ role: "user", content: "isolation question" }];
  const next = [...first, { role: "assistant", content: "answer" }, { role: "user", content: "follow up" }];
  const execute = (messages, apiKey) => executor.execute({ model: "pplx-auto", body: { messages }, stream: false, credentials: { apiKey } });
  await execute(first, "fake-session-a");
  await execute(next, "fake-session-b");
  await execute(next, "fake-session-a");
  expect(requests[1].params.last_backend_uuid).toBeNull();
  expect(requests[2].params.last_backend_uuid).toBe("fake-thread");
});

it("isolates continuations created by streaming responses", async () => {
  const requests = [];
  global.fetch = vi.fn(async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return new Response(`data: ${JSON.stringify({ backend_uuid: "stream-thread", text: "stream answer", status: "COMPLETED" })}\n\ndata: [DONE]\n\n`);
  });
  const executor = new PerplexityWebExecutor();
  const first = [{ role: "user", content: "stream isolation question" }];
  const next = [...first, { role: "assistant", content: "stream answer" }, { role: "user", content: "continue" }];
  const execute = (messages, accessToken, stream) => executor.execute({ model: "pplx-auto", body: { messages }, stream, credentials: { accessToken } });
  const initial = await execute(first, "fake-bearer-a", true);
  await initial.response.text();
  await execute(next, "fake-bearer-b", false);
  await execute(next, "fake-bearer-a", false);
  expect(requests[1].params.last_backend_uuid).toBeNull();
  expect(requests[2].params.last_backend_uuid).toBe("stream-thread");
});
