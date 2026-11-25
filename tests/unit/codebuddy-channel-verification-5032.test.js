import { describe, expect, it } from "vitest";
import { CodeBuddyExecutor } from "../../open-sse/executors/codebuddy-cn.js";
import { CodeBuddyIntlExecutor } from "../../open-sse/executors/codebuddy-intl.js";

const BILLING = "x-anthropic-billing-header: cc_version=2.1.0; cc_entrypoint=sdk-cli;";
const GIT = "Main branch (you will usually use this for PRs): main";

describe("9router #5032 CodeBuddy channel verification (11128)", () => {
  describe.each([
    ["codebuddy-cn", new CodeBuddyExecutor()],
    ["codebuddy-intl", new CodeBuddyIntlExecutor()],
  ])("%s", (_name, executor) => {
    const send = (messages) => executor.transformRequest("fixture-model", { messages }, false, {}).messages;

    it("replaces external channel markers in system and developer text", () => {
      const out = send([
        { role: "system", content: `${BILLING}\nAlways reply in JSON.\n${GIT}` },
        { role: "developer", content: [{ type: "text", text: GIT }] },
        { role: "user", content: "hello" },
      ]);
      const sent = JSON.stringify(out);

      expect(sent).not.toContain("x-anthropic-billing-header");
      expect(sent).not.toContain("Main branch (you will usually use this for PRs):");
      expect(out.find((m) => m.role === "system" && m.content.includes("Always reply in JSON.")).content)
        .toBe("[external-client-identity]: cc_version=2.1.0; cc_entrypoint=sdk-cli;\nAlways reply in JSON.\n[external-client-identity] main");
    });

    it("never rewrites conversation turns", () => {
      const messages = [
        { role: "system", content: "Repository rules." },
        { role: "user", content: `${BILLING}\n${GIT}` },
        { role: "assistant", content: `${BILLING}\n${GIT}`, tool_calls: [{ id: "c1", type: "function", function: { name: "f", arguments: GIT } }] },
        { role: "tool", tool_call_id: "c1", content: GIT },
      ];
      expect(send(structuredClone(messages))).toEqual(messages);
    });

    it("sends the channel conversation and request ids", () => {
      const headers = executor.buildHeaders({ accessToken: "fixture", apiKey: "fixture" }, true);
      expect(headers["X-Conversation-ID"]).toBeTruthy();
      expect(headers["X-Conversation-Request-ID"]).toBe(headers["X-Request-ID"]);
      expect(headers["X-Conversation-Message-ID"]).toBe(headers["X-Request-ID"]);
      expect(headers["User-Agent"]).toMatch(/^CLI\//);
    });
  });
});
