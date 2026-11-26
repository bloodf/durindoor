import { expect, it } from "vitest";
import { normalizeGithubChatStream } from "../../open-sse/executors/githubChatStream.js";

it.each(["\n", "\r\n", "\r"])("repairs GitHub chunks and preserves metadata (%j)", async (eol) => {
  const wire = [": ping", "event: message", "id: upstream", "retry: 1000", "data", 'data: {"id":"chat-1","choices":[{"delta":{"content":null}}]}', "", ""].join(eol);
  const bytes = new TextEncoder().encode(wire);
  const body = new ReadableStream({ start(controller) {
    for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
    controller.close();
  } });
  expect(await normalizeGithubChatStream(new Response(body)).text()).toBe(
    ': ping\nevent: message\nid: upstream\nretry: 1000\ndata: {"id":"chat-1","choices":[{"delta":{}}]}\n\n'
  );
});

it("preserves GitHub errors and terminals", async () => {
  const wire = 'event: error\r\ndata: {"error":"upstream"}\r\n\r\ndata: broken\r\n\r\ndata: [DONE]';
  expect(await normalizeGithubChatStream(new Response(wire)).text()).toBe(`${wire}\n\n`);
});
