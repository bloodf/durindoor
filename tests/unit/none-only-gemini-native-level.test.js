// #2648 follow-up: native Gemini (`gemini-level`) skips an unknown
// thinkingLevel so the upstream can judge it. On a model whose declared
// efforts are only `none`, that skip returned the explicit request unchanged;
// it must be a local 400 instead. Missing/blank/none settings stay untouched,
// and every other model keeps native passthrough of unknown levels.
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  isNativePassthrough: vi.fn(() => false),
}));

vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: () => ({ noAuth: false, execute: mocks.execute, refreshCredentials: vi.fn(async () => null) }),
}));
vi.mock("../../open-sse/utils/requestLogger.js", () => ({
  createRequestLogger: async () => ({
    logClientRawRequest: vi.fn(),
    logRawRequest: vi.fn(),
    logTargetRequest: vi.fn(),
    logError: vi.fn(),
  }),
}));
vi.mock("../../open-sse/utils/clientDetector.js", () => ({
  detectClientTool: () => null,
  isNativePassthrough: mocks.isNativePassthrough,
  isCodexOriginatedHeaders: () => false,
}));
vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
  startActiveSession: vi.fn(),
  updateActiveSession: vi.fn(),
  finishActiveSession: vi.fn(),
}));

const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");
const { applyThinking, extractThinking } = await import("../../open-sse/translator/concerns/thinkingUnified.js");
const { translateRequest } = await import("../../open-sse/translator/index.js");
const { FORMATS } = await import("../../open-sse/translator/formats.js");
const { getCapabilitiesForModel } = await import("../../open-sse/providers/capabilities.js");

const MODEL = "none-only-gemini";
const contents = [{ role: "user", parts: [{ text: "hello" }] }];

const geminiCaps = (operator = {}) => {
  const caps = { reasoning: true, thinkingFormat: "gemini-level", thinkingEfforts: ["none"], ...operator };
  Object.defineProperty(caps, "customKeys", {
    value: new Set(["thinkingFormat", "thinkingEfforts", ...Object.keys(operator)]), enumerable: false,
  });
  return caps;
};

const catchError = (fn) => {
  try { fn(); } catch (error) { return error; }
  throw new Error("expected a throw");
};

// Every wrapper / casing path extractThinking reads a Gemini level from.
const levelAt = (value) => [
  { thinkingConfig: { thinkingLevel: value } },
  { thinking_config: { thinking_level: value } },
  { generationConfig: { thinkingConfig: { thinkingLevel: value } } },
  { generationConfig: { thinking_config: { thinking_level: value } } },
  { generation_config: { thinkingConfig: { thinking_level: value } } },
  { generation_config: { thinking_config: { thinkingLevel: value } } },
  { request: { thinkingConfig: { thinkingLevel: value } } },
  { request: { generationConfig: { thinkingConfig: { thinkingLevel: value } } } },
  { request: { generation_config: { thinking_config: { thinking_level: value } } } },
  { thinkingLevel: value },
  { thinking_level: value },
];

const apply = (body, caps = geminiCaps(), provider = "custom-gemini") =>
  applyThinking(FORMATS.GEMINI, MODEL, { contents, ...body }, provider, undefined, caps);

describe("none-only native Gemini: unknown thinkingLevel is explicit intent (#2648)", () => {
  it.each(["bogus", "XHIGH", "  Ultra  ", "max", 3, { level: "high" }, true])(
    "rejects %j at every wrapper/casing path with a local 400",
    (value) => {
      for (const body of levelAt(value)) {
        const error = catchError(() => apply(body));
        expect(error.statusCode, JSON.stringify(body)).toBe(400);
        expect(error.unsupportedReasoningEffort).toBe(true);
        expect(error.message).toContain(MODEL);
      }
    },
  );

  it("still rejects recognized levels in any casing", () => {
    for (const body of [...levelAt("HIGH"), ...levelAt(" minimal ")]) {
      expect(catchError(() => apply(body)).statusCode).toBe(400);
    }
  });

  it.each([undefined, null, "", "   ", false, "none", "OFF"])(
    "leaves a missing, blank or disabling level %j untouched",
    (value) => {
      for (const body of levelAt(value)) {
        const sent = apply(structuredClone(body));
        expect(sent).toEqual({ contents, ...body });
      }
    },
  );

  it("keeps a recognized budget-0 disable on a none-only model", () => {
    expect(() => apply({ generationConfig: { thinkingConfig: { thinkingBudget: 0 } } })).not.toThrow();
  });

  it("reports the unknown level in the error", () => {
    const error = catchError(() => apply({ generationConfig: { thinkingConfig: { thinkingLevel: "Bogus" } } }));
    expect(error.message).toContain('"bogus"');
    expect(error.message).toContain('send "none"');
  });

  it("also covers the gemini-budget renderer and a model that cannot disable", () => {
    expect(catchError(() => apply({ thinkingConfig: { thinkingLevel: 7 } }, geminiCaps({ thinkingFormat: "gemini-budget" }))).statusCode).toBe(400);
    const error = catchError(() => apply({ thinkingConfig: { thinkingLevel: "bogus" } }, geminiCaps({ thinkingCanDisable: false })));
    expect(error.statusCode).toBe(400);
    expect(error.message).not.toContain('send "none"');
  });
});

describe("other native Gemini models keep unknown-level passthrough", () => {
  it("does not treat an unknown level as intent when a reasoning tier is declared", () => {
    const caps = geminiCaps({ thinkingEfforts: ["none", "low", "high"] });
    for (const value of ["bogus", 3]) {
      for (const body of levelAt(value)) {
        expect(extractThinking(body, MODEL, "custom-gemini", caps)).toBeNull();
        expect(apply(structuredClone(body), caps)).toEqual({ contents, ...body });
      }
    }
  });

  it("keeps the catalog gemini-level row unchanged", () => {
    const caps = getCapabilitiesForModel("gemini", "gemini-3-pro-preview");
    expect(caps.thinkingFormat).toBe("gemini-level");
    const body = { contents, generationConfig: { thinkingConfig: { thinkingLevel: "bogus" } } };
    expect(extractThinking(body, "gemini-3-pro-preview", "gemini")).toBeNull();
    expect(applyThinking(FORMATS.GEMINI, "gemini-3-pro-preview", structuredClone(body), "gemini"))
      .toEqual(body);
  });

  it("still picks a valid fallback level after an unknown one", () => {
    const body = { thinkingConfig: { thinkingLevel: "bogus" }, generationConfig: { thinkingConfig: { thinkingLevel: "low" } } };
    expect(extractThinking(body, MODEL, "custom-gemini", geminiCaps({ thinkingEfforts: ["low", "high"] })))
      .toEqual({ mode: "level", level: "low" });
  });
});

describe("translated request paths (#2648)", () => {
  const translate = (target, body, caps) => translateRequest(
    FORMATS.GEMINI, target, MODEL, { contents, ...body },
    false, null, "custom-gemini", null, [], null, null, { modelCapabilities: caps },
  );

  it.each([FORMATS.GEMINI, FORMATS.OPENAI])("Gemini → %s refuses an unknown level on a none-only model", (target) => {
    const body = { generationConfig: { thinkingConfig: { thinkingLevel: "bogus" } } };
    expect(catchError(() => translate(target, body, geminiCaps())).statusCode).toBe(400);
  });

  it("Gemini → Gemini leaves a request without a level alone", () => {
    expect(() => translate(FORMATS.GEMINI, { generationConfig: { temperature: 0.2 } }, geminiCaps())).not.toThrow();
  });
});

describe("chatCore HTTP handling (#2648)", () => {
  beforeEach(() => {
    mocks.execute.mockReset();
    mocks.execute.mockRejectedValue(new Error("stop after dispatch"));
    mocks.isNativePassthrough.mockReset();
    mocks.isNativePassthrough.mockReturnValue(false);
  });

  const dispatch = (clientBody, { passthrough = false, caps = geminiCaps(), provider = "gemini" } = {}) => {
    mocks.isNativePassthrough.mockReturnValue(passthrough);
    const body = { contents, ...clientBody };
    return handleChatCore({
      body,
      modelInfo: { provider, model: MODEL },
      credentials: { apiKey: "test-key" },
      sourceFormatOverride: FORMATS.GEMINI,
      modelCapabilities: caps,
      clientRawRequest: { endpoint: `/v1beta/models/${MODEL}:generateContent`, body, headers: {} },
      connectionId: "connection-2648-gemini",
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });
  };

  it.each([false, true])("returns a local 400 without dispatching (passthrough=%s)", async (passthrough) => {
    const result = await dispatch({ generationConfig: { thinkingConfig: { thinkingLevel: "bogus" } } }, { passthrough });
    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
    expect(JSON.stringify(await result.response.json())).toContain("bogus");
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("dispatches a request without a level", async () => {
    await dispatch({ generationConfig: { temperature: 0.1 } }).catch(() => {});
    expect(mocks.execute).toHaveBeenCalled();
  });

  it("forwards an unknown level unchanged for a model with reasoning tiers", async () => {
    const caps = geminiCaps({ thinkingEfforts: ["low", "high"] });
    await dispatch({ generationConfig: { thinkingConfig: { thinkingLevel: "bogus" } } }, { passthrough: true, caps }).catch(() => {});
    expect(mocks.execute).toHaveBeenCalled();
    expect(mocks.execute.mock.calls[0][0].body.generationConfig.thinkingConfig.thinkingLevel).toBe("bogus");
  });
});
