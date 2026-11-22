import { afterEach, describe, expect, it } from "vitest";
import { LmarenaExecutor } from "../../open-sse/executors/lmarena.js";
import { __setTlsFetchOverrideForTesting } from "../../open-sse/services/lmarenaTlsClient.js";

const model = "claude-haiku-4-5-20251001";
const sourceEvent = `data: ${JSON.stringify({ text: "Arena streamed answer" })}\n\n`;

afterEach(() => __setTlsFetchOverrideForTesting(null));

describe("LMArena streaming", () => {
  it("forwards the TLS client's streamed body as OpenAI SSE", async () => {
    let requestOptions;
    __setTlsFetchOverrideForTesting(async (_url, options) => {
      requestOptions = options;
      return {
        status: 200,
        headers: new Headers({ "content-type": "text/event-stream" }),
        text: null,
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(sourceEvent));
            controller.close();
          },
        }),
      };
    });

    const result = await new LmarenaExecutor().execute({
      model,
      body: { messages: [{ role: "user", content: "hello" }] },
      stream: true,
      credentials: { cookie: "arena-auth-prod-v1=synthetic" },
    });

    expect(requestOptions.stream).toBe(true);
    const responseText = await result.response.text();
    expect(responseText).toContain('"content":"Arena streamed answer"');
    expect(responseText).toContain("data: [DONE]");
  });
});
