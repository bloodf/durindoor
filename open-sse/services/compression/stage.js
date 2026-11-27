import { isFunction, isRecord } from "../../../src/shared/utils/typeChecks.js";
import { gateStep } from "./fidelityGate.js";

/**
 * Shared transaction for sync/async mutating savers. Work on an isolated body,
 * gate against the untouched input, then commit in place for legacy callers.
 * A throw, rejection or fidelity failure returns null without changing input.
 * An explicit null gate retains plain RTK's legacy policy with the same isolation.
 */
export function runCompressionStage(body, apply, { id, gate = {}, log, resultBody } = {}) {
  const reject = (error) => {
    log?.warn?.("COMPRESS", `engine ${id} failed, step rolled back: ${error?.message || error}`);
    return null;
  };
  try {
    const working = structuredClone(body);
    const commit = (result) => {
      try {
        if (!result) return null;
        const output = resultBody ? resultBody(result, working) : working;
        if (!isRecord(output)) throw new Error("malformed body");
        const verdict = gate === null ? { passed: true } : gateStep(body, output, gate);
        if (!verdict.passed) throw new Error(`fidelity gate rejected step (${verdict.failedInvariant}: ${verdict.detail})`);
        for (const key of Object.keys(body)) delete body[key];
        Object.assign(body, output);
        return result;
      } catch (error) {
        return reject(error);
      }
    };
    const result = apply(working);
    return result && isFunction(result.then) ? result.then(commit, reject) : commit(result);
  } catch (error) {
    return reject(error);
  }
}
