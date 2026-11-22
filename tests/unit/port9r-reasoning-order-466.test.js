import { expect, it } from "vitest";
import { createResponsesApiTransformStream } from "../../open-sse/transformer/responsesTransformer.js";

it("finishes reasoning before adding the answer", async () => {
  const chunks = [
    { choices: [{ index: 0, delta: { reasoning_content: "thinking" } }] },
    { choices: [{ index: 0, delta: { content: "answer" }, finish_reason: "stop" }] },
  ];
  const source = new ReadableStream({ start(controller) {
    for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(chunk)}\n\n`));
    controller.close();
  } });
  const text = await new Response(source.pipeThrough(createResponsesApiTransformStream())).text();
  const events = text.split("\n").filter((line) => line.startsWith("data: {")).map((line) => JSON.parse(line.slice(6)));
  const reasoningDone = events.findIndex((event) => event.type === "response.output_item.done" && event.item.type === "reasoning");
  const messageAdded = events.findIndex((event) => event.type === "response.output_item.added" && event.item.type === "message");
  expect(reasoningDone).toBeGreaterThanOrEqual(0);
  expect(messageAdded).toBeGreaterThan(reasoningDone);
});
