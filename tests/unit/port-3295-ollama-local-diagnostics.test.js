import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { OLLAMA_LOCAL_CONNECT_TIMEOUT_MS } from "../../open-sse/config/runtimeConfig.js";

describe("port-3295: ollama-local diagnostics + timeout/retry tuning", () => {
  let debugLogMod;
  let dbgSpy;

  beforeEach(async () => {
    vi.resetModules();
    debugLogMod = await import("../../open-sse/utils/debugLog.js");
    dbgSpy = vi.spyOn(debugLogMod, "dbg").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("runtimeConfig export", () => {
    it("exports OLLAMA_LOCAL_CONNECT_TIMEOUT_MS as a positive number, default 120000ms", () => {
      expect(typeof OLLAMA_LOCAL_CONNECT_TIMEOUT_MS).toBe("number");
      expect(OLLAMA_LOCAL_CONNECT_TIMEOUT_MS).toBe(120 * 1000);
    });
  });

  describe("OllamaLocalExecutor constructor", () => {
    it("sets config.timeoutMs to OLLAMA_LOCAL_CONNECT_TIMEOUT_MS and disables 502/503/504 retry", async () => {
      const { OllamaLocalExecutor } = await import("../../open-sse/executors/ollama-local.js");
      const exec = new OllamaLocalExecutor();
      expect(exec.config.timeoutMs).toBe(OLLAMA_LOCAL_CONNECT_TIMEOUT_MS);
      expect(exec.config.retry[502]).toEqual({ attempts: 0, delayMs: 0 });
      expect(exec.config.retry[503]).toEqual({ attempts: 0, delayMs: 0 });
      expect(exec.config.retry[504]).toEqual({ attempts: 0, delayMs: 0 });
    });
  });

  describe("execute() diagnostics", () => {
    async function runExecute(overrides = {}, superImpl = async () => ({ url: "http://localhost:11434/api/chat" })) {
      const { OllamaLocalExecutor } = await import("../../open-sse/executors/ollama-local.js");
      const { DefaultExecutor } = await import("../../open-sse/executors/default.js");
      const exec = new OllamaLocalExecutor();
      const originalExecute = DefaultExecutor.prototype.execute;
      DefaultExecutor.prototype.execute = vi.fn(superImpl);
      try {
        return await exec.execute({
          model: "llama3",
          body: { messages: [{ role: "user", content: "hi" }] },
          stream: false,
          credentials: {},
          ...overrides,
        });
      } finally {
        DefaultExecutor.prototype.execute = originalExecute;
      }
    }

    it("emits pre-flight dbg with tag OLLAMA-LOCAL: model, stream, body size, timeout, max_tokens, tools", async () => {
      await runExecute({
        model: "llama3",
        body: { messages: [{ role: "user", content: "hi" }], max_tokens: 100, tools: [{ name: "a" }] },
        stream: true,
      });

      const preFlight = dbgSpy.mock.calls.find(c => c[0] === "OLLAMA-LOCAL" && String(c[1]).startsWith("→ "));
      expect(preFlight, "expected pre-flight dbg call").toBeTruthy();
      const msg = preFlight[1];
      expect(msg).toContain("model=llama3");
      expect(msg).toContain("stream=true");
      expect(msg).toMatch(/body=\d+(\.\d+)?(B|KB|MB)/);
      expect(msg).toMatch(/timeout=\d+(\.\d+)?(ms|s)/);
      expect(msg).toContain("max_tokens=100");
      expect(msg).toContain("tools=1");
    });

    it("defaults stream/max_tokens/tools when unset", async () => {
      await runExecute({ stream: undefined, body: { messages: [{ role: "user", content: "hi" }] } });
      const preFlight = dbgSpy.mock.calls.find(c => c[0] === "OLLAMA-LOCAL" && String(c[1]).startsWith("→ "));
      expect(preFlight[1]).toContain("stream=unset");
      expect(preFlight[1]).toContain("max_tokens=unset");
      expect(preFlight[1]).toContain("tools=0");
    });

    it("emits success dbg with elapsed + url on successful super.execute", async () => {
      await runExecute({}, async () => ({ url: "http://localhost:11434/api/chat" }));
      const success = dbgSpy.mock.calls.find(c => c[0] === "OLLAMA-LOCAL" && String(c[1]).startsWith("✓ "));
      expect(success, "expected success dbg call").toBeTruthy();
      expect(success[1]).toContain("url=http://localhost:11434/api/chat");
    });

    it("emits failure dbg with timeout diagnosis + env-fix hint when super.execute throws AbortError, then rethrows", async () => {
      const abortErr = new Error("fetch connect timeout");
      abortErr.name = "AbortError";
      await expect(runExecute({}, async () => { throw abortErr; })).rejects.toBe(abortErr);

      const fail = dbgSpy.mock.calls.find(c => c[0] === "OLLAMA-LOCAL" && String(c[1]).startsWith("✖ "));
      expect(fail, "expected failure dbg call").toBeTruthy();
      const msg = fail[1];
      expect(msg).toContain("AbortError");
      expect(msg).toContain("diagnosis");
      expect(msg).toContain(`env fix`);
      expect(msg).toContain("OLLAMA_LOCAL_CONNECT_TIMEOUT_MS=");
    });

    it("skips timeout diagnosis for non-timeout errors", async () => {
      const otherErr = new Error("boom");
      otherErr.name = "TypeError";
      await expect(runExecute({}, async () => { throw otherErr; })).rejects.toBe(otherErr);

      const fail = dbgSpy.mock.calls.find(c => c[0] === "OLLAMA-LOCAL" && String(c[1]).startsWith("✖ "));
      expect(fail).toBeTruthy();
      expect(fail[1]).not.toContain("diagnosis");
    });

    it("emits a messages summary dbg line with role counts and content size", async () => {
      await runExecute({
        body: {
          messages: [
            { role: "system", content: "You are helpful." },
            { role: "user", content: "Hello there friend" },
            { role: "assistant", content: "Hi", tool_calls: [{ id: "1" }] },
          ],
        },
      });

      const summary = dbgSpy.mock.calls.find(c => c[0] === "OLLAMA-LOCAL" && String(c[1]).includes("messages:"));
      expect(summary, "expected messages summary dbg call").toBeTruthy();
      const msg = summary[1];
      expect(msg).toContain("3 msgs");
      expect(msg).toContain("sys=1");
      expect(msg).toContain("tool_calls=1");
      expect(msg).toMatch(/~\d+(\.\d+)?(B|KB|MB) content/);
    });

    it("emits a warnLargeBody breakdown dbg call when body exceeds 200KB", async () => {
      const bigContent = "x".repeat(210 * 1024);
      await runExecute({
        body: { messages: [{ role: "user", content: bigContent }], max_tokens: 50 },
      });

      const warn = dbgSpy.mock.calls.find(c => c[0] === "OLLAMA-LOCAL" && String(c[1]).includes("Large body"));
      expect(warn, "expected large-body warning dbg call").toBeTruthy();
      expect(warn[1]).toContain("total_messages");
      expect(warn[1]).toContain("top offenders");
      expect(warn[1]).toContain("OLLAMA_LOCAL_CONNECT_TIMEOUT_MS");
    });

    it("does not emit warnLargeBody for small bodies", async () => {
      await runExecute({ body: { messages: [{ role: "user", content: "small" }] } });
      const warn = dbgSpy.mock.calls.find(c => c[0] === "OLLAMA-LOCAL" && String(c[1]).includes("Large body"));
      expect(warn).toBeFalsy();
    });
  });
});
