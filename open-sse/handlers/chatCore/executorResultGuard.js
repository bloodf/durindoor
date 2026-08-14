// DurinDoor-adapted executor result guard (OmniRoute#10256).
//
// Source upstream's `normalizeExecutorResult` returns only five canonical keys
// (`response`, `url`, `headers`, `transformedBody`, `attemptStartedAt`) and
// would silently drop DurinDoor fields such as `terminalProvenance` that
// chatCore reads at lines 1009-1010. We adapt the guard to validate the
// minimum required shape while preserving every key on the input.
//
// Behavior:
// - throws `TypeError("Executor result must contain a Response")` for
//   null/undefined, missing response, or non-Response response
// - returns the input unchanged so every existing key (including
//   `attemptStartedAt`, `terminalProvenance`, and any future DurinDoor
//   metadata) survives untouched
//
// Reference: diegosouzapw/OmniRoute#10256 fix(types): normalize executor
// result contracts.
export function isResponseLike(value) {
  if (value == null) return false;
  if (value instanceof Response) return true;
  return (
    typeof value.status === "number" &&
    typeof value.headers?.get === "function" &&
    "body" in value
  );
}

export function validateExecutorResult(result) {
  if (!result || !isResponseLike(result.response)) {
    throw new TypeError("Executor result must contain a Response");
  }
  return result;
}
