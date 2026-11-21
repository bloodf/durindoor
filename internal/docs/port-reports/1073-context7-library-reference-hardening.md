# #1073: Context7 library reference hardening (OmniRoute #20839)

## Source pins

- PR: [OmniRoute #20839](https://github.com/cheaper-inference/OmniRoute/pull/20839)
- Requested implementation head: `fa2199bde75ba499b376be3bc9e4cb6cd08667be`
- Merge commit: `b748429cf5b3aeb142a708fd3e8751b6918b9dc8`
- Compared merge first parent: `355eb07c36fcae2440e6c4407b39542b2000374f`
- Local linear parser audit that selected this scope: `internal/docs/port-reports/1073-linear-existing-parsers-20839.md`

Only the Context7 implementation hunk of the merged PR was read, to confirm the upstream
grammar and the shared-function shape. Upstream test files and any crafted or stress
inputs were not inspected and are not reproduced here. No provider was contacted, no
credential was read, and no benchmark, reproduction, or fuzzing was performed.

## Upstream change that was selected

Upstream keeps one Context7 library-id grammar for both faces of the provider:

- the id is exactly two segments — `/owner/repo`;
- a segment starts with an alphanumeric character, then word characters, hyphens and
  single interior dots (`react.dev`, `next.js`, `some_org`);
- dot-only and dot-run segments (`..`, `a..b`) and trailing dots are rejected;
- the same validator is used by the fetch executor and by the search normalizer, so the
  two cannot drift apart.

## Local state before this change

- Fetch executor (`open-sse/handlers/fetch/index.js`) validated references with
  `^\/([\w.-]+)\/([\w.-]+)\/?$`. That expression allows a segment that is not
  alphanumeric-initial, and allows dot-only or dot-run segments, so a reference such as
  `/owner/..` was accepted there and forwarded verbatim into the canonical id and the
  endpoint path, while the search normalizer rejected the same id.
- Search normalizer (`open-sse/handlers/search/normalizers.js`) already used the stricter
  grammar `^\/[A-Za-z0-9][\w-]*(?:\.[\w-]+)*\/[A-Za-z0-9][\w-]*(?:\.[\w-]+)*$`.

The inconsistency was visible statically in the source alone: the two faces of the same
provider applied different acceptance rules to the same identifier. This is recorded as a
grammar-consistency correction, not as a security characterization.

## Local disposition

One shared grammar, used by both existing modules:

- New `open-sse/shared/context7LibraryId.js` holds the segment rule and exports
  `isValidContext7LibraryId(id)` (canonical `/owner/repo` check) and
  `parseContext7LibraryId(input)` (user reference to canonical id). This is the same
  small shared function the upstream change relies on; it is an internal module, not a new
  parser surface, route, or provider entry point.
- `open-sse/handlers/fetch/index.js` now imports `parseContext7LibraryId` from that
  module instead of keeping its own permissive regex, and re-exports it for the offline
  test.
- `open-sse/handlers/search/normalizers.js` now imports `isValidContext7LibraryId` and
  filters with it instead of keeping a private copy of the regex. Its accepted set is
  unchanged.

Nothing else moved: the other four upstream changes in the merge were already dispositioned
as locally absent in `internal/docs/port-reports/1073-linear-existing-parsers-20839.md`
(model display-name markers, GitHub format inference, GCF scalar quoting, RTK raw-output
slug persistence) and are not part of this port.

## Preserved behavior

- Accepted reference forms are unchanged: `https://context7.com/owner/repo`,
  `http://context7.com/owner/repo`, `https://www.context7.com/owner/repo`,
  `www.context7.com/owner/repo`, `context7.com/owner/repo`, `/owner/repo`, and the bare
  `owner/repo` form, each with at most one optional trailing slash.
- Ordinary dotted and hyphenated segments still parse: `/reactjs/react.dev`,
  `/vercel/next.js`, `/some-org/some_repo`, `/facebook/react`.
- Canonical output is unchanged: the parser returns `/owner/repo`.
- Host and scheme rules are unchanged: a non-Context7 host, a non-http(s) scheme, an
  embedded path, or a third segment is rejected.
- Endpoint construction is unchanged:
  `https://context7.com/api/v1<canonical id>?type=llms.txt`.
- Credential ownership is unchanged: the optional `ctx7sk-*` key still rides as a
  `Bearer` header and is omitted when no key is configured.
- Response, accounting, truncation, and error semantics are unchanged; the 400 response
  for an unusable reference keeps its existing message. No other provider, registry
  entry, route, or credential path was touched.

## Documentation versus source evidence

The accepted-form list above is documented in the source comment at
`open-sse/handlers/fetch/index.js` and in the 400 error message ("a library reference such
as `https://context7.com/reactjs/react.dev` or `/reactjs/react.dev`").

Runtime evidence for the relative and bare forms: `handleFetchCore` calls
`assertOutboundUrlAllowed(url, "public-only")` on the raw request target before the
provider parser runs (`open-sse/handlers/fetch/index.js`), so a relative reference such as
`/reactjs/react.dev` is rejected at that earlier layer with `OUTBOUND_URL_INVALID` before
the Context7 parser is reached. Through the public route only absolute http(s) references
therefore reach the parser today, even though the parser itself accepts the documented
relative and bare forms.

That difference is pre-existing, sits in the shared outbound-URL guard rather than in the
Context7 modules, and was left untouched. The parser keeps accepting every documented
form so that the guard remains the only place that decides which request targets are
allowed to leave the process.

## Tests

`tests/unit/omni-context7-library-reference-hardening.test.js` — offline only:

- accepted reference forms and their canonical ids;
- rejected forms (dot-only and dot-run segments, non-alphanumeric segment starts, extra
  segments, non-Context7 hosts, non-http schemes, query/fragment forms, non-strings);
- parity between the fetch parser and the search normalizer over one candidate table;
- the fetch path rejecting an out-of-grammar reference with 400 without contacting
  Context7;
- unchanged endpoint construction and optional bearer ownership, with and without a key.

```bash
cd tests && node node_modules/vitest/vitest.mjs run --maxWorkers=2 unit/omni-context7-library-reference-hardening.test.js
```

Adjacent offline suites (`unit/search-providers-omniroute-parity.test.js`,
`unit/parallel-web-provider.test.js`, `unit/glm-web-search.test.js`,
`unit/tier-a-apikey-providers.test.js`, `unit/search-credential-destination-1073.test.js`,
`unit/web-fetch-ssrf-607.test.js`, `unit/web-fetch-formats.test.js`,
`unit/ollama-web-fetch-provider.test.js`, `unit/port9r-keenable-web-provider-5604.test.js`)
were also run and pass. No baseline entry was added and no existing test was weakened.
