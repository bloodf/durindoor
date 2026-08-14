import { afterEach, expect, it, vi } from "vitest";
import { PerplexityWebExecutor } from "../../open-sse/executors/perplexity-web.js";

const originalFetch = global.fetch;
const ANSWER = "The Caspian Sea is the world's largest inland body of water.";

function mockPplxStream(events) {
  const sse = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n";
  return new Response(new Blob([sse]).stream(), { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

async function answerFor(events) {
  global.fetch = vi.fn(async () => mockPplxStream(events));
  const { response } = await new PerplexityWebExecutor().execute({
    model: "pplx-auto",
    body: { messages: [{ role: "user", content: "Where is the Caspian Sea?" }], stream: false },
    stream: false,
    credentials: { apiKey: "session" },
  });
  return (await response.json()).choices[0].message.content;
}

afterEach(() => { global.fetch = originalFetch; });

it("extracts answer chunks from workflow_block diff patches", async () => {
  const answer = await answerFor([
    {
      status: "PENDING",
      blocks: [{
        intended_usage: "workflow_root",
        diff_block: {
          field: "workflow_block",
          patches: [{
            op: "add", path: "/steps/1", value: { items: [{ variant: "answer", payload: { text_payload: { variant: "answer", chunks: ["The Caspian "] } } }] },
          }],
        },
      }],
    },
    {
      status: "COMPLETED",
      blocks: [{
        intended_usage: "workflow_root",
        diff_block: {
          field: "workflow_block",
          patches: [{ op: "add", path: "/steps/1/items/0/payload/text_payload/chunks/1", value: "Sea is the world's largest inland body of water." }],
        },
      }],
    },
  ]);

  expect(answer).toBe(ANSWER);
});

it("extracts materialized workflow answers but ignores thinking items", async () => {
  const answer = await answerFor([{
    status: "COMPLETED",
    blocks: [{
      intended_usage: "workflow_root",
      workflow_block: {
        steps: [{ items: [
          { variant: "thinking", payload: { text_payload: { variant: "thinking", chunks: ["Searching the web"] } } },
          { variant: "answer", payload: { text_payload: { variant: "answer", text: ANSWER } } },
        ] }],
      },
    }],
  }]);

  expect(answer).toBe(ANSWER);
});

it("keeps legacy markdown_block answers", async () => {
  const answer = await answerFor([{
    status: "COMPLETED",
    blocks: [{ intended_usage: "markdown", markdown_block: { chunks: [ANSWER], progress: "DONE" } }],
  }]);

  expect(answer).toBe(ANSWER);
});
