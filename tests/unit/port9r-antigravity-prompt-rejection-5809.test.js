import { afterEach, describe, expect, it, vi } from "vitest";
import { AntigravityExecutor, isAntigravityPromptRejection, moveSystemInstructionToContents } from "../../open-sse/executors/antigravity.js";
import { BaseExecutor } from "../../open-sse/executors/base.js";
import { ANTIGRAVITY_PROMPT_REWRITES } from "../../open-sse/config/appConstants.js";

const BARE = JSON.stringify({ error: { code: 429, message: "Resource has been exhausted (e.g. check quota).", status: "RESOURCE_EXHAUSTED" } });
const QUOTA = JSON.stringify({ error: { code: 429, message: "Resource has been exhausted (e.g. check quota).", status: "RESOURCE_EXHAUSTED", details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "QUOTA_EXHAUSTED" }] } });
const res = (status, text) => ({ status, ok: status < 400, headers: { get: () => null }, clone: () => new Response(text, { status }) });

describe("port9r #5809 antigravity detail-free 429 prompt rejection", () => {
  afterEach(() => vi.restoreAllMocks());

  it("classifies only a bare RESOURCE_EXHAUSTED 429", () => {
    expect(isAntigravityPromptRejection(429, BARE)).toBe(true);
    expect(isAntigravityPromptRejection(429, QUOTA)).toBe(false);
    expect(isAntigravityPromptRejection(503, BARE)).toBe(false);
    expect(isAntigravityPromptRejection(429, "not json")).toBe(false);
    expect(isAntigravityPromptRejection(429, "")).toBe(false);
  });

  it("parseError maps a bare rejection to request-scoped 400, leaves real quota 429", () => {
    const ag = new AntigravityExecutor();
    expect(ag.parseError({ status: 429 }, BARE).status).toBe(400);
    expect(ag.parseError({ status: 429 }, QUOTA).status).toBe(429);
  });

  it("computeRetryDelay vetoes retries for a bare rejection", async () => {
    const ag = new AntigravityExecutor();
    expect(await ag.computeRetryDelay(res(429, BARE), 1)).toBe(false);
  });

  it("moveSystemInstructionToContents moves system text to the first user turn", () => {
    const body = { project: "p", request: { systemInstruction: { parts: [{ text: "sys" }] }, contents: [{ role: "user", parts: [{ text: "hi" }] }] } };
    const moved = moveSystemInstructionToContents(body);
    expect(moved.request.systemInstruction).toBeUndefined();
    expect(moved.request.contents[0]).toEqual({ role: "user", parts: [{ text: "sys" }] });
    expect(moved.request.contents).toHaveLength(2);
    expect(moveSystemInstructionToContents({ request: { contents: [] } })).toBeNull();
  });

  it("execute retries once with the system text moved into contents", async () => {
    const spy = vi.spyOn(BaseExecutor.prototype, "execute")
      .mockResolvedValueOnce({ response: res(429, BARE) })
      .mockResolvedValueOnce({ response: res(200, "{}") });
    const log = { warn: vi.fn() };
    const body = { request: { systemInstruction: { parts: [{ text: "sys" }] }, contents: [{ role: "user", parts: [{ text: "hi" }] }] } };
    const out = await new AntigravityExecutor().execute({ model: "gemini-3-pro", body, log });
    expect(spy).toHaveBeenCalledTimes(2);
    expect(out.response.status).toBe(200);
    expect(spy.mock.calls[1][0].body.request.systemInstruction).toBeUndefined();
    expect(log.warn).toHaveBeenCalled();
  });

  it("execute does not retry a real quota 429", async () => {
    const spy = vi.spyOn(BaseExecutor.prototype, "execute").mockResolvedValue({ response: res(429, QUOTA) });
    const body = { request: { systemInstruction: { parts: [{ text: "sys" }] }, contents: [{ role: "user", parts: [{ text: "hi" }] }] } };
    const out = await new AntigravityExecutor().execute({ model: "gemini-3-pro", body });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(out.response.status).toBe(429);
  });

  it("rewrites Hermes and stock Claude Code sentence fingerprints but keeps identifiers", () => {
    let text = "# Finishing the job\nthe deliverable is a working artifact backed by real tool output. Reporting a blocker honestly is always better than inventing a result.\n# Hermes runtime environment\nskill_view(name='hermes-agent')\nDual-use security tools (C2 frameworks, credential testing, exploit development) require clear authorization context: pentesting engagements, CTF competitions, security research, or defensive use cases.";
    for (const { from, to } of ANTIGRAVITY_PROMPT_REWRITES.slice(1)) text = text.replace(from, to);
    expect(text).not.toMatch(/backed by real tool output/);
    expect(text).not.toMatch(/Reporting a blocker honestly/);
    expect(text).not.toMatch(/# Hermes runtime environment/);
    expect(text).not.toMatch(/Dual-use security tools/);
    expect(text).toContain("skill_view(name='hermes-agent')");
  });
});
