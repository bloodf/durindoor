import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleComboChat } from "../../open-sse/services/combo.js";

// OmniRoute #943 (head 629a6936fab709cbc8bd6eb6a2dda8647dcf6d3f, merge
// 7dea0441ac5e6463d0df3817039a085cc8df1059): a provider failure whose body
// is not JSON must still reach the combo fallback classifier as a bounded,
// useful message, exactly like the same message delivered as JSON.

const log = { info() {}, warn() {}, error() {}, debug() {} };

function plainText(body, status = 500, headers = {}) {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", ...headers },
  });
}

function jsonBody(body, status = 500, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

async function run(members) {
  const attempted = [];
  const response = await handleComboChat({
    body: { stream: false, messages: [{ role: "user", content: "hello" }] },
    models: members.map((_, index) => `p${index + 1}/model`),
    handleSingleModel: async (_body, model) => {
      attempted.push(model);
      const index = Number(model.slice(1, model.indexOf("/"))) - 1;
      return members[index].response();
    },
    log,
    comboName: "combo-nonjson-error-classification",
    comboStrategy: "fallback",
  });
  return { attempted, response };
}

const SUCCESS = { response: () => jsonBody({ text: "fallback" }, 200) };

describe("combo non-JSON provider error classification (#943)", () => {
  // The plain-text body must classify like the same message delivered as JSON:
  // the billing rule rotates, the wrong-model rule stops, a request-scoped 4xx
  // is handed back, and a quota rule keeps its own verdict.
  it.each([
    { status: 400, message: "Your credit balance is too low to access the API." },
    { status: 400, message: "model not found" },
    { status: 400, message: "unsupported parameter: foo" },
    { status: 429, message: "quota exceeded" },
  ])("classifies a $status plain-text body like the same JSON message", async ({ status, message }) => {
    // Member selection: the failing member and the member that follows it.
    const plain = await run([
      { response: () => plainText(message, status) },
      SUCCESS,
    ]);
    const json = await run([
      { response: () => jsonBody({ error: { message } }, status) },
      SUCCESS,
    ]);
    expect(plain.attempted).toEqual(json.attempted);

    // Final outcome of the failing member on its own.
    const plainOnly = await run([{ response: () => plainText(message, status) }]);
    const jsonOnly = await run([{ response: () => jsonBody({ error: { message } }, status) }]);
    expect(plainOnly.response.status).toBe(jsonOnly.response.status);
    expect(await plainOnly.response.text()).toContain(message);
    expect(await jsonOnly.response.text()).toContain(message);
  });

  it.each([
    ["plain text", () => plainText("unsupported parameter: foo", 400)],
    ["JSON", () => jsonBody({ error: { message: "unsupported parameter: foo" } }, 400)],
  ])("reads one clone for a request-scoped %s error", async (_format, makeResponse) => {
    const original = makeResponse();
    const clone = original.clone();
    const cloneSpy = vi.spyOn(original, "clone").mockReturnValue(clone);
    const textSpy = vi.spyOn(clone, "text");
    const { response } = await run([{ response: () => original }]);

    expect(cloneSpy).toHaveBeenCalledTimes(1);
    expect(textSpy).toHaveBeenCalledTimes(1);
    expect(response).toBe(original);
    expect(await response.text()).toContain("unsupported parameter: foo");
  });

  it("keeps the plain-text provider reason in the final error message", async () => {
    const { response } = await run([
      { response: () => plainText("quota exceeded for this account", 429) },
    ]);
    expect(response.status).toBe(429);
    const payload = await response.json();
    expect(payload.error.message).toContain("quota exceeded for this account");
  });

  it("bounds the plain-text provider message kept for the classifier", async () => {
    const body = `E${"x".repeat(2000)}`;
    const { response } = await run([{ response: () => plainText(body, 500) }]);
    expect(response.status).toBe(500);
    const payload = await response.json();
    expect(payload.error.message).toHaveLength(500);
    expect(body.startsWith(payload.error.message)).toBe(true);
  });

  it("leaves the original plain-text body readable when the member error stays request-scoped", async () => {
    const { attempted, response } = await run([
      { response: () => plainText("unsupported parameter: foo", 400) },
    ]);
    expect(attempted).toEqual(["p1/model"]);
    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toBe("unsupported parameter: foo");
  });

  it("does not reinterpret a plain-text provider body as a local client abort", async () => {
    const { attempted, response } = await run([
      { response: () => plainText("Client disconnected", 500) },
      SUCCESS,
    ]);
    expect(attempted).toEqual(["p1/model", "p2/model"]);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ text: "fallback" });
  });

  it("keeps the JSON error message alias chain and its selection order", async () => {
    const cases = [
      [{ error: { message: "nested message" } }, "nested message"],
      [{ error: "alias string" }, "alias string"],
      [{ message: "top message" }, "top message"],
      [{ message: "top message", error: { message: "nested message" } }, "nested message"],
    ];
    for (const [body, expected] of cases) {
      const { response } = await run([{ response: () => jsonBody(body, 500) }]);
      expect(response.status).toBe(500);
      const payload = await response.json();
      expect(payload.error.message).toBe(expected);
    }
  });

  it("keeps the JSON retry-after source", async () => {
    const reset = new Date(Date.now() + 120_000).toISOString();
    const { response } = await run([
      { response: () => jsonBody({ error: { message: "slow down" }, retryAfter: reset }, 500) },
    ]);
    expect(response.status).toBe(500);
    const seconds = Number(response.headers.get("retry-after"));
    expect(seconds).toBeGreaterThan(0);
    expect(seconds).toBeLessThanOrEqual(120);
  });

  it("keeps the nested JSON retry-after source", async () => {
    const reset = new Date(Date.now() + 90_000).toISOString();
    const { response } = await run([
      { response: () => jsonBody({ error: { message: "slow down", retry_after: reset } }, 500) },
    ]);
    expect(response.status).toBe(500);
    const seconds = Number(response.headers.get("retry-after"));
    expect(seconds).toBeGreaterThan(0);
    expect(seconds).toBeLessThanOrEqual(90);
  });

  it("keeps the response header as the retry-after source", async () => {
    const { response } = await run([
      { response: () => plainText("upstream busy", 500, { "Retry-After": "120" }) },
    ]);
    expect(response.status).toBe(500);
    const seconds = Number(response.headers.get("retry-after"));
    expect(seconds).toBeGreaterThan(100);
    expect(seconds).toBeLessThanOrEqual(120);
  });
});

describe("combo alias resolution and member selection", () => {
  const originalDataDir = process.env.DATA_DIR;
  let cleanup = () => {};

  afterEach(() => {
    vi.resetModules();
    cleanup();
    cleanup = () => {};
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
  });

  it("resolves a mixed-case combo alias and selects the exactly-cased combo first", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-combo-nonjson-"));
    process.env.DATA_DIR = tempDir;
    vi.resetModules();
    cleanup = () => fs.rmSync(tempDir, { recursive: true, force: true });

    const { createCombo, getComboForModel } = await import("@/lib/localDb");
    const { getComboModels } = await import("@/sse/services/model.js");

    const first = await createCombo({ name: "CodeX", models: ["openai/first"] });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await createCombo({ name: "codex", models: ["openai/second"] });

    await expect(getComboForModel("CODEX")).resolves.toMatchObject({ id: first.id, name: "CodeX" });
    await expect(getComboModels("CODEX")).resolves.toEqual(["openai/first"]);
    await expect(getComboModels("codex")).resolves.toEqual(["openai/second"]);
  });
});
