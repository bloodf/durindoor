import { expect, it } from "vitest";
import { convertResponsesStreamToJson } from "../../open-sse/transformer/streamToJsonConverter.js";

it("recovers a delta-only item alongside a finished item", async () => {
  const reasoning = { id: "rs_0", type: "reasoning", summary: [] };
  const events = [
    { type: "response.output_item.done", output_index: 0, item: reasoning },
    { type: "response.output_text.delta", output_index: 1, delta: "Hel" },
    { type: "response.output_text.delta", output_index: 1, delta: "lo" },
    { type: "response.completed", response: { status: "completed" } },
  ];
  const sse = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
  const result = await convertResponsesStreamToJson(new Response(sse).body);

  expect(result.status).toBe("completed");
  expect(result.output).toEqual([
    reasoning,
    { type: "message", role: "assistant", content: [{ type: "output_text", text: "Hello" }] },
  ]);
});
