# Veo AI Free native video staging (#2034)

Pinned read-only OmniRoute HEAD verified as `c71f0065a7efe9230ec23b96a12253b050c4d7ad`.
Attribution: `open-sse/config/videoRegistry.ts:303`, `open-sse/handlers/videoGeneration.ts:378,548`, and `open-sse/executors/veoaifree-web.ts` (MIT). The named entry is enabled and reachable through the format dispatcher. The handler delegates to the executor; its misleading ComfyUI comment does not change that path.

Local HEAD at inspection: `e7c111f8ba76f01f035675d0ba6ae77cb6334e8e`; checkout's `origin/main`: `f14f877ec13d6a9c58ed5a7d8f665526f748e76e`. No remote fetch or live provider call was used. Both local and origin/main video cores already special-case the canonical identity and call the existing executor. The provider definition already has alias `veo-free`, exact AJAX endpoint, no authentication, video kind, and models `veo` / `seedance`; the executor map has both identities. Shared metadata needs no duplicate provider. The synchronous core's special-case predicate only recognizes the canonical identity; future adapter registration must cover both.

## Wire comparison and remaining delta

Local executor `open-sse/executors/veoaifree-web.js` already fetches the nonce from the homepage and posts the exact WordPress URL-encoded envelope: `action=veo_video_generator`, `nonce`, `prompt`, `totalVariations=1`, `aspectRatio`, `actionType=full-video-generate`. Polling posts `sceneData` and `actionType=final-video-results`. Model names are not forwarded on this wire; both registry models select the same site tool. These are real existing equivalents, not inferred from a generic config name.

Pinned source adds selected WordPress cookie representations, per-call Set-Cookie merging, login/rate-limit recognition, and a downloaded, size-capped, validated MP4 returned as one `b64_json` item with `format=mp4`. Its handler explicitly rejects URL-only results. Local executor instead returns URL items, lacks session cookies, follows redirects and swallows poll errors. The staged adapter ports the missing session/auth and error contracts with bounded calls and total deadline, manual redirect refusal, caller abort and conservative accepted-job accounting. It does not duplicate the provider definition or activate a new route.

## Supported subset and deliberate restrictions

The private default adapter and factory implement the existing local synchronous media adapter contract. Registration instructions and exact exported identities are in the adjacent `registration.json`. Only text prompts up to 10,000 characters, the two pinned model IDs, one variation, and landscape/portrait site enum aspect ratios are accepted. `size` is supported only as the same site enum, matching the source's pass-through mapping; pixel sizes and conflicting values are rejected. Unknown fields, references, images, duration, audio options, streams and base64 are rejected before network activity. The source registry has static models; no dynamic discovery API is present. Dynamic nonce acquisition and session cookie updates are supported.

Results deliberately use the local URL-only contract. The first public HTTPS candidate is returned without fetching it or claiming MP4 validation. Credentials, ports, fragments, and local/private/reserved hosts are refused using the local SSRF classifier. DNS resolution and artifact downloads do not occur. This is a narrower output contract than pinned OmniRoute: base64 MP4 download, availability retries, content-type checks and MP4 signature verification are **not implemented or advertised**. URL availability and content are not verified. Registration must preserve this documented restriction or implement the artifact path separately.

Session precedence is providerSpecificData cookie / `wordpress_logged_in*`, then API key (plain cookie, bare value, JSON object or cookie array). Registry authentication remains `none`; no OAuth bearer is synthesized. The source homepage request intentionally omits stored Cookie; source Set-Cookie then merges into the selected call's jar. AJAX requests include the current jar. No cross-call storage or credential rotation occurs. Existing cookie/OAuth/API-key connection modes are untouched. Proxy options remain selected-connection scoped. Site quota may be IP-based; this adapter cannot measure a remaining balance or claim per-account free usage.

Each network call plus response body is bounded to 30 seconds and 64 KiB; total work is bounded to 660 seconds, with at most 30 polls 20 seconds apart. Cancellation aborts transport and polling. Tests can reduce these bounds. Errors contain a fixed message, never upstream text, nonce, cookies or scene data. Submission happens once. Every failure after submit invocation conservatively retains unknown-cost `acceptedJob`, including an explicit refusal: this may overrecord pending work but never falsely establishes that no work was accepted. Success reports one returned video; cost, tokens and duration remain unknown. The selected connection identity belongs to the calling route's ledger; the adapter neither chooses nor substitutes a connection.

## Evidence

Closed mocks only; no accounts, browser, paid API, Docker or live provider requests. Focused command:

```sh
cd tests && node node_modules/vitest/vitest.mjs run unit/native-veoaifree-web-video.test.js --maxWorkers=2
```

26 tests passed, covering exact headers/body, nonce, session shapes and two connections, URL normalization, static model inventory, login/quota/failure sanitization, unsupported input rejection, malformed/oversized replies, unsafe outputs, redirects, uncertain submission without replay, network and total deadlines, and cancellation before submission and during polling. Only the isolated staging registration block asserts absence from the production adapter registry. Protocol/auth/security/accounting tests instantiate the private factory directly.

No shared registry/catalog edits or production imports. No full suite run, as requested.

## Contract evidence matrix

The focused test file exercises the private factory independently of production
registration. Each network response below is synthetic.

| Contract | Assertion |
| --- | --- |
| Registry identity | Canonical ID, alias, no-auth fields, format and both model IDs match the pinned registry. |
| Session setup | Homepage request omits Cookie; its Set-Cookie is merged into the selected connection's jar. |
| Submission | Exact Origin, Referer, User-Agent, Cookie, content type and all six form fields are asserted. |
| Polling | Exact nonce, sceneData and final-video-results action are asserted. |
| Session renewal | Submit Set-Cookie is included on the subsequent poll. |
| Connection isolation | A second credential sends its own WordPress cookie without inheriting the first call's session. |
| Output | A returned HTTPS URL is normalized; one returned video is counted with unknown cost. |
| Unsupported input | Duration, images, streaming, base64, multiple variations and pixel sizes fail before fetch. |
| Authentication and quota | Login text, rate-limit text and HTTP 429 become sanitized failures. |
| Uncertain submission | Transport failure after invoking submit retains acceptedJob and never resubmits. |
| Unsafe results | HTTP, loopback, URL credentials and custom ports are refused. |
| Redirects | A manual redirect response fails without requesting its destination. |
| Deadlines | Hanging fetch, hanging response body, total polling time and exhausted poll count terminate. |
| Cancellation | Pre-aborted calls send nothing; cancellation while polling retains accepted-job evidence. |
| Malformed responses | Missing nonce and oversized submit text fail without quoting upstream bodies. |

## Gate correction

The first independent gate passed all 26 focused tests but rejected lint.
Reproduction with `pnpm run lint:anti-slop` identified five runtime `typeof`
checks and one conditional empty-object spread in the staged adapter.
The adapter now uses the repository's `isString` and `isRecord` predicates
and assigns the optional request body explicitly. No lint suppression,
baseline change or test weakening was introduced.

The earlier report contained 34 physical lines with long prose paragraphs.
This matrix makes the verification evidence independently scannable and records
the concrete lint correction; it does not imply broader protocol support.

Correction validation: all 26 focused tests passed again; scoped ESLint and
oxlint passed; `pnpm run lint:anti-slop` passed with zero diagnostics across
3,255 files. The generated lint bundle was restored after verification so only
allowed work-order paths enter the correction commit.
