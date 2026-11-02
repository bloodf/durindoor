// #1099: compression fidelity eval + protected-block gates.
import { describe, expect, it } from "vitest";
import {
  bodyToText,
  checkFidelity,
  checkProtectedBlocks,
  gateStep,
} from "../../../open-sse/services/compression/fidelityGate.js";
import { CORPUS_VERSION, FIDELITY_CORPUS } from "../../../open-sse/services/compression/eval/corpus.js";
import { runFidelityEval } from "../../../open-sse/services/compression/eval/runFidelityEval.js";
import { runCompressionSeam } from "../../../open-sse/handlers/chatCore/compressionHook.js";

// Failures that already-shipped engines show on the pinned corpus. Recorded so
// the gate below can require ZERO failures for every engine not listed here,
// and so a fix or a new regression in a listed engine both fail this test.
// caveman rewrites unfenced diffs ("index 1a2b3c4..5d6e7f8" -> "Index 1a2b3c4.5d6e7f8").
const EXISTING_ENGINE_BASELINE = {
  caveman: ["diff-hunks:numeric"],
  "session-dedup": [],
  headroom: [],
};

const clone = (v) => structuredClone(v);

describe("corpus coverage", () => {
  it("is pinned and covers every kind required by #1099", () => {
    expect(CORPUS_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
    const kinds = new Set(FIDELITY_CORPUS.map((c) => c.kind));
    for (const kind of ["code", "json", "urls", "multilingual", "negation", "tool-failure", "images", "instruction-boundaries"]) {
      expect(kinds.has(kind), kind).toBe(true);
    }
    expect(new Set(FIDELITY_CORPUS.map((c) => c.id)).size).toBe(FIDELITY_CORPUS.length);
  });
});

describe("checkProtectedBlocks", () => {
  const caseBody = (id) => clone(FIDELITY_CORPUS.find((c) => c.id === id).body);

  it("passes an identical body", () => {
    for (const c of FIDELITY_CORPUS) expect(checkProtectedBlocks(c.body, clone(c.body)).passed, c.id).toBe(true);
  });

  it("rejects a changed tool schema", () => {
    const out = caseBody("json-tool-output");
    out.tools[0].function.description = "Read a file.";
    expect(checkProtectedBlocks(caseBody("json-tool-output"), out)).toMatchObject({ passed: false, failedInvariant: "tool-schemas" });
  });

  it("rejects an altered error tool result (Claude and OpenAI shapes)", () => {
    const claude = caseBody("tool-failures");
    claude.messages[2].content[0].content = "Error: ECONNREFUSED";
    expect(checkProtectedBlocks(caseBody("tool-failures"), claude).failedInvariant).toBe("protected-blocks");
    const openai = caseBody("openai-error-tool");
    openai.messages[2].content = "EACCES";
    expect(checkProtectedBlocks(caseBody("openai-error-tool"), openai).failedInvariant).toBe("protected-blocks");
  });

  it("rejects altered images, PDFs and thinking signatures", () => {
    const img = caseBody("images-and-pdf");
    img.messages[0].content[1].source.data = "AAAA";
    expect(checkProtectedBlocks(caseBody("images-and-pdf"), img).passed).toBe(false);
    const sig = caseBody("thinking-signatures");
    sig.messages[1].content[0].thinking = "The user wants a plan.";
    expect(checkProtectedBlocks(caseBody("thinking-signatures"), sig).passed).toBe(false);
    const url = caseBody("openai-image-url");
    url.messages[0].content[1] = { type: "text", text: "[image: png]" };
    expect(checkProtectedBlocks(caseBody("openai-image-url"), url).passed).toBe(false);
  });

  it("rejects changed instructions and system/developer messages", () => {
    const sys = caseBody("instruction-boundaries");
    sys.messages[0].content = "SYSTEM POLICY: Answer in English.";
    expect(checkProtectedBlocks(caseBody("instruction-boundaries"), sys).passed).toBe(false);
    const claude = caseBody("tool-failures");
    claude.system[0].text = "Use tools.";
    expect(checkProtectedBlocks(caseBody("tool-failures"), claude).failedInvariant).toBe("instructions");
    const responses = caseBody("responses-tool-output");
    responses.instructions = "You are a coding agent.";
    expect(checkProtectedBlocks(caseBody("responses-tool-output"), responses).failedInvariant).toBe("instructions");
  });

  it("rejects edits inside a fenced code block but allows prose edits around it", () => {
    const edited = caseBody("code-fenced");
    edited.messages[1].content = edited.messages[1].content.replace("return a + b;   ", "return a + b;");
    expect(checkProtectedBlocks(caseBody("code-fenced"), edited).failedInvariant).toBe("protected-blocks");
    const prose = caseBody("code-fenced");
    prose.messages[1].content = prose.messages[1].content.replace("I would like you to please take", "Take");
    expect(checkProtectedBlocks(caseBody("code-fenced"), prose).passed).toBe(true);
  });

  it("fails open on internal errors", () => {
    const cyclic = { messages: [] };
    cyclic.self = cyclic;
    expect(checkProtectedBlocks(cyclic, {}).passed).toBe(true);
  });
});

describe("checkFidelity", () => {
  it("catches dropped negations, numbers, URLs, JSON keys and diff hunks", () => {
    expect(checkFidelity("Do not delete the db.", "Delete the db.").failedInvariant).toBe("negation");
    expect(checkFidelity("Não altere a planilha.", "Altere a planilha.").failedInvariant).toBe("negation");
    expect(checkFidelity("retry 3 times on port 5432", "retry 3 times").failedInvariant).toBe("numeric");
    expect(checkFidelity("see https://example.com/a", "see the docs").failedInvariant).toBe("protected-tokens");
    expect(checkFidelity('{"a": 1, "b": 2}', '{"a": 1, 2}', { checkNumericIntegrity: false }).failedInvariant).toBe("json-keys");
    expect(checkFidelity("@@ -1,2 +1,3 @@ x", "x", { checkNumericIntegrity: false }).failedInvariant).toBe("diff-hunks");
    expect(checkFidelity("please do not panic, 42", "do not panic, 42").passed).toBe(true);
  });

  it("bodyToText reaches Responses, Claude system and tool results", () => {
    const text = bodyToText(FIDELITY_CORPUS.find((c) => c.id === "responses-tool-output").body);
    expect(text).toContain("You are a coding agent.");
    expect(text).toContain("worker heartbeat ok");
  });

  it("gateStep applies text invariants only when opted in", () => {
    const input = { messages: [{ role: "user", content: "Do not delete it." }] };
    const output = { messages: [{ role: "user", content: "Delete it." }] };
    expect(gateStep(input, output).passed).toBe(true);
    expect(gateStep(input, output, { textInvariants: true }).failedInvariant).toBe("negation");
  });
});

describe("offline fidelity eval", () => {
  it("reports estimated (not provider-reported) per-engine savings", async () => {
    const report = await runFidelityEval();
    expect(report.tokenSource).toBe("estimated");
    expect(report.providerReportedTokens).toBeNull();
    expect(report.costUsd).toBeNull();
    expect(report.corpusVersion).toBe(CORPUS_VERSION);
    for (const [id, summary] of Object.entries(report.perEngine)) {
      expect(summary.cases, id).toBe(FIDELITY_CORPUS.length);
      expect(summary.errors, id).toBe(0);
      expect(summary.estimatedTokensBefore, id).toBeGreaterThan(0);
    }
  });

  it("gates every available engine on corpus invariants (baseline recorded)", async () => {
    const report = await runFidelityEval();
    const failuresByEngine = {};
    for (const r of report.records) {
      failuresByEngine[r.engine] ??= [];
      for (const f of r.failures) failuresByEngine[r.engine].push(`${r.caseId}:${f.invariant}`);
    }
    for (const [id, failures] of Object.entries(failuresByEngine)) {
      // A newly available engine has no baseline entry, so it must be clean.
      expect(failures.sort(), id).toEqual((EXISTING_ENGINE_BASELINE[id] ?? []).slice().sort());
    }
  });

  it("flags an engine that mutates its input or alters protected blocks", async () => {
    const bad = {
      id: "bad",
      apply(body) {
        body.model = "mutated";
        const out = structuredClone(body);
        if (out.tools) out.tools = [];
        return { body: out, compressed: true };
      },
    };
    const report = await runFidelityEval({ engineIds: ["bad"], getEngine: () => bad });
    const invariants = report.records.flatMap((r) => r.failures.map((f) => f.invariant));
    expect(invariants).toContain("input-mutated");
    expect(invariants).toContain("tool-schemas");
  });
});

describe("seam per-step gate", () => {
  const deps = (apply) => ({
    isEngineAvailable: () => true,
    getEngine: () => ({ apply }),
    deriveDefaultPlan: () => ({ mode: "stacked", stackedPipeline: [{ engine: "x" }] }),
    resolveAdaptivePlan: ({ basePlan }) => ({ plan: basePlan }),
    planToEngineIds: () => ["x"],
  });

  it("rolls back a step that alters an error tool result", async () => {
    const body = clone(FIDELITY_CORPUS.find((c) => c.id === "openai-error-tool").body);
    const apply = async (b) => {
      const out = structuredClone(b);
      out.messages[2].content = "EACCES";
      return { body: out, compressed: true };
    };
    const warnings = [];
    const out = await runCompressionSeam(body, deps(apply), { enabled: true, log: { warn: (...a) => warnings.push(a.join(" ")) } });
    expect(out.body).toBe(body);
    expect(out.headerValue).toBeNull();
    expect(warnings.join("\n")).toMatch(/fidelity gate rejected step \(protected-blocks/);
  });

  it("text invariants roll back a dropped negation only when enabled", async () => {
    const body = { messages: [{ role: "user", content: "Please do not delete the production database today." }] };
    const apply = async (b) => ({ body: { messages: [{ role: "user", content: "Delete the production database today." }] }, compressed: true });
    const off = await runCompressionSeam(clone(body), deps(apply), { enabled: true });
    expect(off.headerValue).toMatch(/^x\|/);
    const on = await runCompressionSeam(clone(body), deps(apply), { enabled: true, fidelityGate: { textInvariants: true } });
    expect(on.headerValue).toBeNull();
    expect(on.body.messages[0].content).toBe(body.messages[0].content);
  });
});
