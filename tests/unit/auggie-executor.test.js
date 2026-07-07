import { afterAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  AuggieExecutor,
  buildAuggiePrompt,
  resolveAuggieBin,
  resolveAuggieModel,
  __test__,
} from "../../open-sse/executors/auggie.js";
import { getExecutor, hasSpecializedExecutor } from "../../open-sse/executors/index.js";
import { PROVIDERS } from "../../open-sse/config/providers.js";
import { PROVIDER_MODELS } from "../../open-sse/config/providerModels.js";
import { FREE_PROVIDERS } from "../../src/shared/constants/providers.js";

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-auggie-test-"));

function writeFakeBin(name, script) {
  const file = path.join(TMP_DIR, name);
  fs.writeFileSync(file, `#!/bin/sh\n${script}\n`, { mode: 0o755 });
  return file;
}

async function readSseEvents(response) {
  const text = await response.text();
  return text
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => line.slice("data: ".length).trim())
    .filter((payload) => payload && payload !== "[DONE]")
    .map((payload) => JSON.parse(payload));
}

afterAll(() => {
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
});

describe("AuggieExecutor", () => {
  it("passes only flags in argv and sends the prompt through stdin", () => {
    const args = __test__.buildAuggieArgs("claude-sonnet-4.6");
    expect(args).not.toContain("--");
    expect(args).not.toContain("Hello world");
    expect(args).toEqual(["--print", "--quiet", "--model", "claude-sonnet-4.6"]);
  });

  it("detects Windows .cmd/.bat shims for shell launch", () => {
    const prevPlatform = Object.getOwnPropertyDescriptor(process, "platform");
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
    try {
      expect(__test__.isWindowsCmdScript("auggie.cmd")).toBe(true);
      expect(__test__.isWindowsCmdScript("auggie.bat")).toBe(true);
      expect(__test__.isWindowsCmdScript("auggie.exe")).toBe(false);
    } finally {
      Object.defineProperty(process, "platform", prevPlatform || { value: "linux", configurable: true });
    }
  });

  it("flattens OpenAI messages into the local CLI prompt format", () => {
    expect(buildAuggiePrompt([
      { role: "system", content: "Be terse." },
      { role: "user", content: [{ type: "text", text: "hi" }] },
      { role: "assistant", content: "hello" },
    ])).toBe("[System]\nBe terse.\n\n[User]\nhi\n\n[Assistant]\nhello");
  });

  it("honors AUGGIE_BIN for local binary discovery", () => {
    const previous = process.env.AUGGIE_BIN;
    process.env.AUGGIE_BIN = "/tmp/fake-auggie";
    try {
      expect(resolveAuggieBin()).toBe("/tmp/fake-auggie");
    } finally {
      if (previous === undefined) delete process.env.AUGGIE_BIN;
      else process.env.AUGGIE_BIN = previous;
    }
  });

  it("validates model ids before they reach the subprocess argv", () => {
    expect(resolveAuggieModel("claude-haiku-4.5")).toEqual({ ok: true, model: "claude-haiku-4.5" });
    expect(resolveAuggieModel("-bad").ok).toBe(false);
    expect(resolveAuggieModel("not-a-model").ok).toBe(false);
  });

  it("returns non-streaming chat completion output from the fake CLI", async () => {
    const bin = writeFakeBin("fake-auggie-ok.sh", 'cat');
    const previous = process.env.AUGGIE_BIN;
    process.env.AUGGIE_BIN = bin;
    try {
      const { response, transformedBody } = await new AuggieExecutor().execute({
        model: "claude-opus-4.6",
        body: { messages: [{ role: "user", content: "say hi" }] },
        stream: false,
        credentials: {},
      });
      const body = await response.json();
      expect(response.status).toBe(200);
      expect(body.object).toBe("chat.completion");
      expect(body.choices[0].message.content).toContain("say hi");
      expect(transformedBody.model).toBe("claude-opus-4.6");
    } finally {
      if (previous === undefined) delete process.env.AUGGIE_BIN;
      else process.env.AUGGIE_BIN = previous;
    }
  });

  it("streams local CLI stdout as OpenAI-compatible SSE deltas", async () => {
    const bin = writeFakeBin("fake-auggie-stream.sh", 'printf "streamed text"');
    const previous = process.env.AUGGIE_BIN;
    process.env.AUGGIE_BIN = bin;
    try {
      const { response } = await new AuggieExecutor().execute({
        model: "claude-sonnet-4.6",
        body: { messages: [{ role: "user", content: "say hi" }] },
        stream: true,
        credentials: {},
      });
      const events = await readSseEvents(response);
      const text = events.map((event) => event.choices?.[0]?.delta?.content || "").join("");
      expect(response.headers.get("Content-Type")).toBe("text/event-stream");
      expect(text).toBe("streamed text");
      expect(events.at(-1).choices[0].finish_reason).toBe("stop");
    } finally {
      if (previous === undefined) delete process.env.AUGGIE_BIN;
      else process.env.AUGGIE_BIN = previous;
    }
  });

  it("rejects unknown models without spawning the CLI", async () => {
    const marker = path.join(TMP_DIR, "should-not-spawn");
    const bin = writeFakeBin("fake-auggie-spawn-guard.sh", `touch "${marker}"\nprintf "bad"`);
    const previous = process.env.AUGGIE_BIN;
    process.env.AUGGIE_BIN = bin;
    try {
      const { response } = await new AuggieExecutor().execute({
        model: "unknown-model",
        body: { messages: [{ role: "user", content: "hi" }] },
        stream: false,
        credentials: {},
      });
      expect(response.status).toBe(400);
      expect((await response.json()).error.message).toMatch(/Unknown Auggie model/);
      expect(fs.existsSync(marker)).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.AUGGIE_BIN;
      else process.env.AUGGIE_BIN = previous;
    }
  });

  it("registers Auggie as a no-auth specialized provider and aug alias", () => {
    expect(getExecutor("auggie")).toBeInstanceOf(AuggieExecutor);
    expect(getExecutor("aug")).toBeInstanceOf(AuggieExecutor);
    expect(hasSpecializedExecutor("auggie")).toBe(true);
    expect(PROVIDERS.auggie.noAuth).toBe(true);
    expect(PROVIDER_MODELS.aug.some((model) => model.id === "claude-sonnet-4.6")).toBe(true);
    expect(FREE_PROVIDERS.auggie.noAuth).toBe(true);
  });
});
