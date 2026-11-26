import { describe, expect, it } from "vitest";
import { formatModelProbeErrors, updateModelProbeErrors } from "../../src/shared/utils/modelTestResults.js";

describe("overlapping model probes", () => {
  it("retains unrelated failures until that model and connection succeeds", async () => {
    let errors = {};
    let finishFailure;
    let finishSuccess;
    const probe = (model, connection, completion) => completion.then((error) => {
      errors = updateModelProbeErrors(errors, model, connection, error);
    });
    const failure = probe("model-a", "connection-a", new Promise((resolve) => { finishFailure = resolve; }));
    const success = probe("model-b", "connection-b", new Promise((resolve) => { finishSuccess = resolve; }));
    finishFailure("unreachable");
    await failure;
    finishSuccess(null);
    await success;
    expect(formatModelProbeErrors(errors)).toBe("model-a (connection-a): unreachable");
    errors = updateModelProbeErrors(errors, "model-a", "connection-b", null);
    expect(formatModelProbeErrors(errors)).toContain("unreachable");
    errors = updateModelProbeErrors(errors, "model-a", "connection-a", null);
    expect(formatModelProbeErrors(errors)).toBe("");
  });
});
