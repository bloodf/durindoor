// Offline compression fidelity eval.
//
// Runs every dispatchable engine over the pinned corpus and reports per-engine
// estimated savings, invariant failures and errors. No provider call is made.
// Token numbers come from the production estimator (stats.js) and are labelled
// `estimated`: they are NOT provider-reported usage and carry no cost. Provider
// usage and billing are only known after a real upstream response and are
// recorded by the usage pipeline, never by this eval.
//
// Mechanical-savings shape follows OmniRoute eval/savings.ts
// (diegosouzapw/OmniRoute@61e07fb7, MIT, PR #4720).

import { ENGINE_IDS, getEngine as realGetEngine, isEngineAvailable } from "../index.js";
import { estimateCompressionTokens } from "../stats.js";
import { gateStep } from "../fidelityGate.js";
import { CORPUS_VERSION, FIDELITY_CORPUS } from "./corpus.js";

function savingsPercent(before, after) {
  return before > 0 ? Math.round((before - after) / before * 10000) / 100 : 0;
}

async function evalCase(engine, testCase, applyOpts) {
  const input = structuredClone(testCase.body);
  const pristine = JSON.stringify(input);
  const tokensBefore = estimateCompressionTokens(input);
  const record = { engine: engine.id, caseId: testCase.id, kind: testCase.kind, estimatedTokensBefore: tokensBefore };
  let output;
  try {
    const res = await engine.apply(input, { config: applyOpts, stepConfig: { engine: engine.id } });
    output = res?.body ?? input;
  } catch (e) {
    return { ...record, status: "error", estimatedTokensAfter: tokensBefore, estimatedSavingsPercent: 0, failures: [], error: String(e?.message || e) };
  }
  const failures = [];
  if (JSON.stringify(input) !== pristine) {
    failures.push({ invariant: "input-mutated", detail: "engine mutated the caller body" });
  }
  const changed = JSON.stringify(output) !== pristine;
  if (changed) {
    const verdict = gateStep(testCase.body, output, { textInvariants: true });
    if (!verdict.passed) failures.push({ invariant: verdict.failedInvariant, detail: verdict.detail });
  }
  const tokensAfter = estimateCompressionTokens(output);
  return {
    ...record,
    status: changed ? "compressed" : "unchanged",
    estimatedTokensAfter: tokensAfter,
    estimatedSavingsPercent: savingsPercent(tokensBefore, tokensAfter),
    failures
  };
}

/**
 * @param {object} [opts]
 * @param {string[]} [opts.engineIds] defaults to every available catalog engine
 * @param {Array} [opts.corpus] defaults to FIDELITY_CORPUS
 * @param {object} [opts.applyOpts] engine `config` forwarded to apply()
 * @param {Function} [opts.getEngine] DI for tests
 */
export async function runFidelityEval(opts = {}) {
  const getEngine = opts.getEngine ?? realGetEngine;
  const engineIds = opts.engineIds ?? ENGINE_IDS.filter(isEngineAvailable);
  const corpus = opts.corpus ?? FIDELITY_CORPUS;
  const records = [];
  for (const id of engineIds) {
    const engine = getEngine(id);
    for (const testCase of corpus) records.push(await evalCase(engine, testCase, opts.applyOpts ?? {}));
  }

  const perEngine = {};
  for (const id of engineIds) {
    const rows = records.filter((r) => r.engine === id);
    const before = rows.reduce((s, r) => s + r.estimatedTokensBefore, 0);
    const after = rows.reduce((s, r) => s + r.estimatedTokensAfter, 0);
    perEngine[id] = {
      cases: rows.length,
      compressed: rows.filter((r) => r.status === "compressed").length,
      unchanged: rows.filter((r) => r.status === "unchanged").length,
      errors: rows.filter((r) => r.status === "error").length,
      failures: rows.reduce((s, r) => s + r.failures.length, 0),
      estimatedTokensBefore: before,
      estimatedTokensAfter: after,
      estimatedSavingsPercent: savingsPercent(before, after)
    };
  }

  return {
    corpusVersion: CORPUS_VERSION,
    tokenSource: "estimated",
    providerReportedTokens: null,
    costUsd: null,
    perEngine,
    records
  };
}
