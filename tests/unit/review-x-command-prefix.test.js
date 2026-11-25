import { describe, expect, it } from "vitest";
import { detectClaudeCodeMetaReply } from "../../open-sse/utils/claudeCodeMetaRequests.js";

const reply = (command) => detectClaudeCodeMetaReply({
  messages: [{ role: "user", content: `<policy_spec>rules</policy_spec>\nCommand: ${command}` }],
}, { commandPrefix: true });

describe("local command prefix allowlist", () => {
  it("answers plain commands", () => {
    expect(reply("git status --short")).toEqual({ kind: "command-prefix", text: "git status" });
  });

  it.each([
    "git status > output", "git status < input", "cat <(id)", "echo $HOME",
    "FOO=bar git status", "echo Command: git status", "echo\nCommand: git status",
    "git status; id", "git status | id", "git status & id", "echo `id`",
    "echo $(id)", "echo {a,b}", "echo \\x", "echo #comment", "echo\nid",
    "echo 'quoted'", "echo *.js",
  ])("forwards unsafe or ambiguous command %s", (command) => {
    expect(reply(command)).toBeNull();
  });
});
