import { describe, it, expect } from "vitest";
import { prepareChatgptPlanRequest } from "../../open-sse/executors/chatgpt-plan.js";

// OmniRoute #20734: ChatGPT rejects additional_tools input items without the developer role.
describe("chatgpt-plan additional_tools role (OmniRoute #20734)", () => {
  it("sets role developer on the inserted additional_tools item and keeps client tools", () => {
    const fn = { type: "function", name: "lookup", parameters: { type: "object" } };
    const custom = { type: "custom", name: "patch" };
    const web = { type: "web_search" };
    const body = prepareChatgptPlanRequest("gpt-5", {
      input: [{ role: "system", content: "s" }, { role: "user", content: "hi" }],
      tools: [fn, custom, web],
    });
    expect(body.input[0]).toEqual({ type: "additional_tools", role: "developer", tools: [fn, custom] });
    expect(body.input[1].role).toBe("developer");
    expect(body.tools).toEqual([web]);
  });

  it("does not insert additional_tools without client tools", () => {
    const body = prepareChatgptPlanRequest("gpt-5", { input: "hi", tools: [{ type: "web_search" }] });
    expect(body.input.some((i) => i.type === "additional_tools")).toBe(false);
  });
});
