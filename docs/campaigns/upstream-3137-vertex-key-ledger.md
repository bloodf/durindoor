# Upstream PR Port — #3137 (2026-08-11)

`decolua/9router` pull request verified against this fork before implementing.
Anchors live in [`docs/UPSTREAM_SYNC.md`](../UPSTREAM_SYNC.md).

| PR | Verdict | Evidence | Action |
| --- | --- | --- | --- |
| [#3137](https://github.com/decolua/9router/pull/3137) `fix(vertex): validate service-account private_key before minting a token` | PORTED | `refreshVertexToken` (`open-sse/services/tokenRefresh.js`) and `POST /api/providers/validate` (`src/app/api/providers/validate/route.js`) both handed a Vertex service-account JSON's `private_key` straight to `jose`'s `importPKCS8(..., "RS256")`. A malformed PEM, a non-RSA key, or an RSA key under 2048 bits produced an opaque `jose` crypto error instead of an actionable message, and the validate route previously accepted any service-account JSON with the three required fields present (`client_email`, `private_key`, `project_id`) without checking the key itself. | Add `validateVertexSaKey(saJson)` using `node:crypto`'s `createPrivateKey` — no new dependency. It rejects a missing key, an unparsable PEM, a non-RSA key, and an RSA key under 2048 bits, each with a distinct actionable message, before any `jose` import happens. `refreshVertexToken` calls it first and logs+bails on failure instead of throwing from inside `importPKCS8`. The validate route's `vertex` and `vertex-partner` cases call the same validator for service-account JSON input, so refresh and validation report identical errors. Tests in `tests/unit/vertex-sa-key.test.js`. |

## Adaptations

- **Shared validator, not upstream's inline checks.** Upstream repeats its key-shape checks per callsite; here both callsites (`refreshVertexToken` and the validate route) import one `validateVertexSaKey` from `open-sse/services/tokenRefresh.js` so refresh and API-key validation never drift.
- **Raw-key probe unchanged.** DurinDoor's validate route also accepts a *raw* (non-JSON) Vertex API key and probes a Google endpoint to classify it as valid/invalid. That branch is untouched — `validateVertexSaKey` only applies to parsed service-account JSON, never to the raw-key probe path.
- **`createPrivateKey` before `jose`.** Using Node's built-in `node:crypto` to reject bad/weak/non-RSA keys before the dynamic `jose` import keeps the fast-fail path dependency-free and avoids importing `jose` at all for a key that will never pass.

## Verification

- `tests/node_modules/.bin/vitest run --root . --config tests/vitest.config.js tests/unit/vertex-sa-key.test.js`
  - RED (before `validateVertexSaKey` was wired into the validate route):
    ```text
    AssertionError: expected { valid: true, error: null } to deeply equal { valid: false, …(1) }

    Expected:
    {
      "error": "Vertex: service account private_key must be RSA-2048 or larger (RS256), got 1024 bits",
      "valid": false,
    }

    Received:
    {
      "error": null,
      "valid": true,
    }
    ```
  - GREEN (after wiring both `vertex` and `vertex-partner` switch cases to call `validateVertexSaKey`):
    ```text
     Test Files  1 passed (1)
          Tests  3 passed (3)
    ```
