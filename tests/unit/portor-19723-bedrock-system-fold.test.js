import { describe, expect, it } from "vitest";

import { openAIToBedrockConverse } from "../../open-sse/executors/bedrock.js";

const messages = [
  { role: "system", content: "Answer in French." },
  { role: "developer", content: "Be brief." },
  { role: "user", content: "Hello" },
];

describe("OmniRoute #19723 - Bedrock models without system prompts", () => {
  it.each([
    "amazon.titan-text-premier-v1:0",
    "cohere.command-text-v14",
    "cohere.command-light-text-v14",
    "mistral.mistral-7b-instruct-v0:2",
    "us.mistral.mixtral-8x7b-instruct-v0:1",
    "arn:aws:bedrock:us-east-1::foundation-model/amazon.titan-text-express-v1",
  ])("folds the system text into the first user turn for %s", (model) => {
    const payload = openAIToBedrockConverse(model, { messages });

    expect(payload.system).toBeUndefined();
    expect(payload.messages).toEqual([
      { role: "user", content: [{ text: "Answer in French.\nBe brief." }, { text: "Hello" }] },
    ]);
  });

  it("adds a user turn when the history starts with the assistant", () => {
    const payload = openAIToBedrockConverse("amazon.titan-text-express-v1", {
      messages: [
        { role: "system", content: "Be brief." },
        { role: "assistant", content: "Earlier answer" },
        { role: "user", content: "Next question" },
      ],
    });

    expect(payload.messages[0]).toEqual({ role: "user", content: [{ text: "Be brief." }] });
    expect(payload.messages[1].role).toBe("assistant");
  });

  it.each([
    "anthropic.claude-sonnet-4-6",
    "cohere.command-r-plus-v1:0",
    "mistral.mistral-large-2402-v1:0",
    "amazon.nova-pro-v1:0",
  ])("keeps the system block for %s", (model) => {
    const payload = openAIToBedrockConverse(model, { messages });

    expect(payload.system).toEqual([{ text: "Answer in French." }, { text: "Be brief." }]);
    expect(payload.messages[0].content).toEqual([{ text: "Hello" }]);
  });
});
