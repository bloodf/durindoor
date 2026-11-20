# 1073: keep proxy fallback for replayable Blob request bodies

Reviewed 2026-11-20. Follow-up to the #5770 non-replayable-body guard recorded in
[`1073-proxy-nonreplayable-request.md`](1073-proxy-nonreplayable-request.md) and
[`1073-july-merged-source-scope.md`](1073-july-merged-source-scope.md).

## Problem

`#2097` (`fix(gateway): harden remote image fetches and preserve stream output`) added the
non-replayable-body guard to the ordinary non-strict proxy fallback in
`open-sse/utils/proxyFetch.js`. The guard classified a body as non-replayable when it exposed
`getReader()`, `pipe()`, `stream()` or `Symbol.asyncIterator`.

`Blob.prototype.stream()` and `File.prototype.stream()` exist on every standard Blob and File.
A standard Blob holds immutable bytes, so `stream()` only hands out a *fresh* reader over those
bytes every time; it is not a one-shot stream. The guard therefore classified every ordinary
Blob and File body as non-replayable.

The consequence is a published regression: when a proxied dispatch fails, a request carrying a
standard Blob body no longer falls back to the direct transport. Instead the original proxy
error propagates, even though the body was fully replayable and the ordinary non-strict path is
supposed to retry it directly.

Upstream OmniRoute #5770 shares the same broad shape (`isStreamLikeBody` checks `getReader` and
`stream`), but upstream applies the guard to the *direct* undici dispatcher retry/native-fallback
loop and treats Blob as non-replayable there too. This report does not claim upstream parity for
the Blob case; it records the DurinDoor-specific correction to the shape #2097 published.

## Fix

`open-sse/utils/proxyFetch.js` gains `isReplayableBlob(body)`, which recognizes a body that is an
instance of `globalThis.Blob` or `globalThis.File`, and `hasNonReplayableBody` consults it before
the stream-like heuristic:

```js
function isReplayableBlob(body) {
  if (!isObject(body) && !isFunction(body)) return false;
  if (!isUndefined(globalThis.Blob) && body instanceof globalThis.Blob) return true;
  return !isUndefined(globalThis.File) && body instanceof globalThis.File;
}

function hasNonReplayableBody(input, body) {
  if (isReplayableBlob(body)) return false;
  if (body != null && (isObject(body) || isFunction(body)) &&
    (isFunction(body.getReader) || isFunction(body.pipe) || isFunction(body.stream) ||
      isFunction(body[Symbol.asyncIterator]))) return true;
  return !isUndefined(globalThis.Request) && input instanceof globalThis.Request &&
    (input.bodyUsed || input.body !== null);
}
```

`isReplayableBlob` uses `instanceof` only. It never reads, clones, locks or otherwise disturbs the
body, so the replay decision stays a pure shape inspection.

### Body classification after the fix

| Body | Classification | Behavior in the ordinary non-strict proxy path |
| --- | --- | --- |
| `Blob` | replayable | proxy dispatch, then one direct dispatch on failure |
| `File` | replayable | proxy dispatch, then one direct dispatch on failure |
| string / `Buffer` / `URLSearchParams` / `ArrayBuffer` | replayable | unchanged direct fallback |
| one-shot `ReadableStream` | non-replayable | one proxy dispatch, original proxy error, no direct dispatch |
| node `Readable` / async iterable / `stream()`-only object | non-replayable | unchanged |
| `Request` with a body, or with `bodyUsed === true` | non-replayable | one proxy dispatch, original proxy error, no direct dispatch |

### Preserved behavior

- **Non-replayable bodies** keep the original proxy failure and a single proxy dispatch, with no
  direct dispatch and no body read.
- **`strictProxy`** still fails closed with `[ProxyFetch] Proxy required but failed
  (strictProxy=true)` and never reaches the direct transport.
- **Abort propagation** still rethrows the abort reason ahead of the fallback decision.
- **Quota-dispatch failures** still propagate unchanged.
- **The specialized `directTransport.withProxy` transport** still fails with
  `[ProxyFetch] Proxied transport failed` instead of falling back directly.
- **The MITM DNS bypass and Vercel relay paths** are untouched.
- **No retry path was added.** The change only decides whether the already-established ordinary
  direct fallback applies; it introduces no new attempt, no dispatcher retry and no diagnostic
  mutation.

## Evidence

`tests/unit/omni-proxy-replayable-blob.test.js` covers the assigned scenario offline with injected
proxy and direct mocks and synthetic payloads. It asserts:

1. A standard `Blob` keeps the direct fallback and the direct transport receives the original body.
2. A standard `File` keeps the direct fallback.
3. Deciding to replay a Blob does not call `stream()` or `arrayBuffer()` on it.
4. A Blob whose bytes were already read once still replays.
5. A one-shot `ReadableStream` keeps a single proxy dispatch and the original failure, with no
   direct dispatch.
6. A `Request` with `bodyUsed` false and true keeps a single proxy dispatch and the original
   failure, without changing `bodyUsed`.
7. `strictProxy`, abort and the specialized `withProxy` transport keep their existing behavior for
   a Blob body.

The independent offline reference scenario
`/tmp/durindoor-review8.UUrbfcad/tree/tests/unit/review8-offline.test.js`
("replays a Blob after ordinary proxy failure") was run against a copy of the fixed module: it
passes with the fix and fails without it (`result: "mock proxy failure"`, `directCalls: 0`). Only
that scenario was used; the other three scenarios in that file belong to other orders.

No live requests, provider traffic, paid APIs, browser, Docker or e2e runs were used. Focused
tests are not global coverage.

## Limits

- The Blob/File replayability rule covers standard `Blob` and `File` instances only. A custom
  object that mimics `Blob` without inheriting from it keeps the previous non-replayable
  classification.
- `Request` inputs remain non-replayable whenever they carry a body or have been used, matching
  the #5770 intent; a `Request` whose body is a Blob is still refused, because the `Request`
  itself owns that body rather than the caller holding a reusable Blob reference.
