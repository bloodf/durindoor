// OmniRoute #20961 (preferred-account failover wiring), offline evidence only.
// Not applicable: the port is gated on an existing preferred-account / response-start
// deadline setting (the Resilience preference). DurinDoor has no such setting, so this
// file pins that the settings surface and the single-model retry loop are unchanged.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(js|jsx|mjs)$/.test(name) && !/\.test\./.test(name)) out.push(full);
  }
  return out;
}

const SETTING_RE = /preferredAccount|preferred_account|preferredApiKey|responseStartDeadline|responseStartTimeout|preferredResponseStart|preferredFailover/i;

describe("OmniRoute #20961: preferred-account response-start failover is not applicable", () => {
  it("has no preferred-account or response-start deadline setting anywhere in src or open-sse", () => {
    const files = [...walk(join(ROOT, "src")), ...walk(join(ROOT, "open-sse"))];
    expect(files.length).toBeGreaterThan(100);
    expect(files.filter((file) => SETTING_RE.test(readFileSync(file, "utf8")))).toEqual([]);
  });

  it("has no Resilience settings page or route to host the preference", () => {
    const files = [...walk(join(ROOT, "src/app")), ...walk(join(ROOT, "src/lib"))];
    expect(files.filter((file) => /resilience/i.test(file.slice(ROOT.length)))).toEqual([]);
  });

  it("keeps preferredConnectionId meaning an explicit pin that is terminal on failure", () => {
    const chat = read("src/sse/handlers/chat/singleModel.js");
    expect(chat).toMatch(/let preferredConnectionId = null;/);
    expect(chat).toContain("pinned connection ${preferredConnectionId.slice(0, 8)} failed; pin is terminal");
    expect(chat).toContain("refusing rotation");
    expect(SETTING_RE.test(chat)).toBe(false);
  });

  it("keeps the retry loop free of a request-scoped response-start timeout branch", () => {
    const chat = read("src/sse/handlers/chat/singleModel.js");
    const loop = chat.slice(chat.indexOf("let accountAttempts = 0;"));
    expect(loop).toContain("while (true) {");
    expect(loop).toContain("excludeConnectionIds.add(credentials.connectionId);");
    expect(loop).not.toMatch(/responseStart|response-start|preferredHop|siblingHop|hintTimeout/i);
  });
});
