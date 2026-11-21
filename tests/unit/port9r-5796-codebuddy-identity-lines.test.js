import { describe, expect, it } from "vitest";
import { CodeBuddyExecutor } from "../../open-sse/executors/codebuddy-cn.js";
import { CodeBuddyIntlExecutor } from "../../open-sse/executors/codebuddy-intl.js";

const NEUTRAL_PROMPT = "You are a helpful AI assistant that helps with software engineering tasks.";
const longRules = `Instructions from: /workspace/AGENTS.md\nAlways address the user as Captain.\n${"Follow strict repository guidelines. ".repeat(80)}`;
const identity = "You are an AI coding agent.";

describe("9router #5796 CodeBuddy identity line sanitization", () => {
  it.each([
    ["codebuddy-cn", new CodeBuddyExecutor()],
    ["codebuddy-intl", new CodeBuddyIntlExecutor()],
  ])("preserves user rules and typed block structure for %s", (_name, executor) => {
    const typedBlock = { type: "text", text: `${identity}\n\n${longRules}`, cache_control: { type: "ephemeral" } };
    const systemPrompt = `${identity}\n\n${longRules}`;
    const messages = [
      { role: "system", content: systemPrompt },
      { role: "developer", content: [typedBlock, { type: "image_url", image_url: { url: "fixture" } }] },
      { role: "user", content: identity },
    ];
    const output = executor.transformRequest("fixture-model", { messages }, false, {});

    const system = output.messages.find((message) => message.role === "system" && message.content !== "You are a helpful assistant.");
    expect(system.content).toBe(`${NEUTRAL_PROMPT}\n\n${longRules}`);
    expect(system.content.length).toBeGreaterThan(2000);
    const developer = output.messages.find((message) => message.role === "developer");
    expect(developer.content).toEqual([
      { ...typedBlock, text: `${NEUTRAL_PROMPT}\n\n${longRules}` },
      { type: "image_url", image_url: { url: "fixture" } },
    ]);
    expect(output.messages.find((message) => message.role === "user").content).toBe(identity);
  });

  it("leaves nonmatching system prompt bytes unchanged", () => {
    const prompt = "  Repository rules stay exactly as written.\r\nUse tabs only.  ";
    const output = new CodeBuddyExecutor().transformRequest("fixture-model", {
      messages: [{ role: "system", content: prompt }],
    }, false, {});
    expect(output.messages[0].content).toBe(prompt);
  });
});
