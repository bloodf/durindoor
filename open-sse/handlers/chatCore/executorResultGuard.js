// DurinDoor-adapted executor result guard (OmniRoute#10256, #10373).
//
// Upstream `normalizeExecutorResult` returns only five canonical keys
// (`response`, `url`, `headers`, `transformedBody`, `transport`) and would
// silently drop DurinDoor fields such as `attemptStartedAt` and
// `terminalProvenance` that `executeProvider` reads/sets in chatCore.js
// (around lines 964-970, consumed again at ~1009). We adapt the guard to
// spread every existing key back onto the normalized result instead of
// replacing the whole object, then overwrite only the four canonical fields
// upstream validates.
//
// Behavior:
// - bare `Response` -> wrapped as `{ response, url: "", headers: {},
//   transformedBody: null }`
// - object without a Response-like `.response` -> throws
//   `TypeError("Executor result must contain a Response")`
// - object with a Response-like `.response` -> new object: every input key
//   preserved via spread, `response`/`url`/`headers`/`transformedBody`
//   normalized to their canonical defaults
//
// Reference: diegosouzapw/OmniRoute#10256 fix(types): normalize executor
// result contracts; #10373 fix(sse): stop executor-contract guard from
// hot-looping router (isResponseLike, not `instanceof Response`, to survive
// undici/global Response identity mismatches).
export function isResponseLike(value) {
  if (value == null) return false;
  if (value instanceof Response) return true;
  return (
    typeof value.status === "number" &&
    typeof value.ok === "boolean" &&
    typeof value.headers?.get === "function" &&
    typeof value.text === "function" &&
    "body" in value
  );
}

export function validateExecutorResult(result) {
  if (isResponseLike(result)) {
    return { response: result, url: "", headers: {}, transformedBody: null };
  }
  if (!result || !isResponseLike(result.response)) {
    throw new TypeError("Executor result must contain a Response");
  }
  return {
    ...result,
    response: result.response,
    url: result.url || "",
    headers: result.headers || {},
    transformedBody: result.transformedBody ?? null,
  };
}
