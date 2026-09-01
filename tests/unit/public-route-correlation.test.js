import { describe, expect, it, vi } from "vitest";
import { getRequestId } from "../../src/sse/utils/requestCorrelation.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const harness = vi.hoisted(() => ({ response: null }));

vi.mock("../../src/sse/utils/requestCorrelation.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    withRequestCorrelation: (handler) => actual.withRequestCorrelation((...args) =>
      harness.response ? harness.response(...args) : handler(...args)),
  };
});

const routeModules = import.meta.glob("../../src/app/api/v1/**/route.js");
const handlerModules = import.meta.glob("../../src/sse/handlers/*.js");

const routes = {
  "chat/completions": ["OPTIONS", "POST"],
  completions: ["OPTIONS", "HEAD", "POST"],
  "api/chat": ["OPTIONS", "POST"],
  messages: ["OPTIONS", "POST"],
  "messages/count_tokens": ["OPTIONS", "POST"],
  responses: ["OPTIONS", "POST"],
  "responses/compact": ["OPTIONS", "POST"],
  embeddings: ["OPTIONS", "POST"],
  "audio/speech": ["OPTIONS", "POST"],
  "audio/transcriptions": ["OPTIONS", "POST"],
  "audio/translations": ["OPTIONS", "POST"],
  "audio/voices": ["OPTIONS", "GET"],
  "images/generations": ["OPTIONS", "POST"],
  "images/edits": ["OPTIONS", "POST"],
  moderations: ["OPTIONS", "POST"],
  rerank: ["OPTIONS", "POST"],
  search: ["OPTIONS", "POST"],
  "web/fetch": ["OPTIONS", "POST"],
  "music/generations": ["OPTIONS", "POST"],
  "audio/music": ["OPTIONS", "POST"],
  "video/generations": ["OPTIONS", "POST"],
  "videos/[[...path]]": ["OPTIONS", "POST", "GET"],
  batches: ["OPTIONS", "HEAD", "GET", "POST"],
  "batches/[id]": ["OPTIONS", "GET"],
  "batches/[id]/cancel": ["OPTIONS", "POST"],
  "messages/batches": ["OPTIONS", "HEAD", "GET", "POST"],
  "messages/batches/[id]": ["OPTIONS", "GET"],
  "messages/batches/[id]/cancel": ["OPTIONS", "POST"],
  "messages/batches/[id]/results": ["OPTIONS", "GET"],
  files: ["OPTIONS", "HEAD", "GET", "POST"],
  "files/[id]": ["OPTIONS", "HEAD", "GET", "DELETE"],
  "files/[id]/content": ["OPTIONS", "GET"],
  "models/[...model]": ["OPTIONS", "GET", "HEAD"],
  "[...catchAll]": ["OPTIONS", "GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"],
};

const sharedHandlers = {
  "chat.js": ["handleChat"],
  "countTokens.js": ["handleCountTokens"],
  "embeddings.js": ["handleEmbeddings"],
  "fetch.js": ["handleFetch"],
  "imageEdit.js": ["handleImageEdit"],
  "imageGeneration.js": ["handleImageGeneration"],
  "moderations.js": ["handleModerations"],
  "music.js": ["handleMusicGeneration"],
  "rerank.js": ["handleRerank"],
  "search.js": ["handleSearch"],
  "stt.js": ["handleStt"],
  "tts.js": ["handleTts"],
  "video.js": ["handleVideoGeneration", "handleVideoCreate", "handleVideoGet"],
};

function spoofedRequest(method) {
  return new Request("https://durindoor.test/v1/inventory", {
    method: method === "HEAD" ? "HEAD" : method === "OPTIONS" ? "OPTIONS" : "POST",
    headers: { "x-request-id": "spoofed-client-id" },
  });
}

async function assertInventory(module, exports) {
  for (const name of exports) {
    expect(module[name], name).toEqual(expect.any(Function));
    for (const error of [false, true]) {
      harness.response = (request) => error
        ? Response.json({ error: { message: "inventory failure" } }, { status: 400 })
        : Response.json({ ok: true, request_id: getRequestId(request) });
      const response = await module[name](spoofedRequest(name));
      const requestId = response.headers.get("x-request-id");
      const body = await response.json();

      expect(requestId, `${name} ${error ? "error" : "success"}`).toMatch(UUID);
      expect(requestId).not.toBe("spoofed-client-id");
      if (error) expect(body.error.request_id).toBe(requestId);
      else expect(body).toEqual({ ok: true, request_id: requestId });
    }
  }
}

describe("public correlation runtime inventory", () => {
  it.each(Object.entries(routes))("correlates every %s route export", async (route, exports) => {
    const load = routeModules[`../../src/app/api/v1/${route}/route.js`];
    expect(load, route).toEqual(expect.any(Function));
    await assertInventory(await load(), exports);
  });

  it.each(Object.entries(sharedHandlers))("correlates every shared export in %s", async (file, exports) => {
    const load = handlerModules[`../../src/sse/handlers/${file}`];
    expect(load, file).toEqual(expect.any(Function));
    await assertInventory(await load(), exports);
  });
});
