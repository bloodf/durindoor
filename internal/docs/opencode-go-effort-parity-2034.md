# OpenCode Go DeepSeek effort tiers (#2034)

Compared on 2026-11-20, without provider credentials, account traffic, a
browser, Docker or a paid API. Every statement about an upstream comes from
reading the pinned upstream tree at the SHA below; none of it is evidence that
OpenCode Go currently accepts a particular tier for a particular account.

## Revisions

| Side | Revision | Note |
| --- | --- | --- |
| OmniRoute | [`2b14379604d466005bb18640a898c2811757ef67`](https://github.com/cheaper-inference/OmniRoute/commit/2b14379604d466005bb18640a898c2811757ef67) | `fix(catalog): declare accepted effort tiers for opencode-go/deepseek-v4.1-flash (#20436)`, merged through OmniRoute PR [#20465](https://github.com/cheaper-inference/OmniRoute/pull/20465). |
| DurinDoor | `21ca84f08879` | Comparison base, branch `orq/toruzq/parity-opencode-go-effort-a1`. |

## Upstream sources read

- OmniRoute `open-sse/config/providers/registry/opencode/go/index.ts` — the
  OpenCode Go provider catalog. The DeepSeek rows at lines 415, 422, 432, 477
  and 487 declare `supportedThinkingEfforts`.
- OmniRoute `open-sse/executors/opencode.ts` — `EFFORT_TIERS` (line 314) and
  `EFFORT_LEVELS = ["none", "low", "high", "max"]` (line 172) for the
  `deepseek-v4-pro` / `deepseek-v4-flash` effort-suffix variants. The comment
  above that table names its origin: the first-party OpenCode Go model catalog
  (`opencode models opencode-go --verbose`).
- OmniRoute `open-sse/executors/base/reasoningEffort.ts` — the registry-tier
  clamp (line 813 onwards): a requested tier outside a model's declared
  `supportedThinkingEfforts` is remapped to the nearest declared rung, and the
  catalog and the wire are driven by the same declaration.

The first-party OpenCode Go catalog was not fetched for this comparison: the
work is offline, and the tier sets below are taken from the pinned upstream
catalog that quotes it. The public provider page DurinDoor links for this
provider is `https://opencode.ai/docs/api` (see
`docs/providers/local-router-providers.mdx`).

## DurinDoor surface

| Concern | File |
| --- | --- |
| Served OpenCode Go rows | `open-sse/providers/registry/opencode-go.js` |
| Declared effort tiers (catalog + wire) | `open-sse/providers/thinkingLevels.js` |
| Request normalization | `open-sse/translator/concerns/thinkingUnified.js` |
| Catalog output | `src/app/api/v1/models/buildModelsList.js` (`thinking_levels`) |
| Evidence | `tests/unit/opencode-go-effort-parity.test.js` |

## Reference contract

The OmniRoute provider catalog at the pinned commit declares these
model-scoped tiers for OpenCode Go:

| Model | Declared tiers |
| --- | --- |
| `deepseek-v4-pro` | `none`, `low`, `high`, `max` |
| `deepseek-v4-flash` | `none`, `low`, `high`, `max` |
| `deepseek-v4-flash-vision-exp` | `none`, `low`, `high`, `max` |
| `deepseek-v4.1-flash` | `low`, `high`, `max` |
| `deepseek-flash` | `low`, `high`, `max` |

`deepseek-v4.1-flash` and `deepseek-flash` are the same 1M DeepSeek V4.1 Flash
upstream; the narrower `low | high | max` set is the change introduced by the
pinned commit (#20436 / #20465). The three older rows keep the
`none | low | high | max` set that the OpenCode Go effort-suffix variants
already used upstream.

## Reproduced defect

The advertised catalog and the normalized request disagreed, in both
directions.

1. **The chat lane collapsed every tier.** `applyThinking` resolved the
   OpenCode Go DeepSeek rows to the `deepseek` thinking format, whose wire
   branch sent `reasoning_effort: "high"` for every requested tier
   (`wantsMax && isNativeDeepSeekV4(...) ? "max" : "high"`). The `low` and
   `max` tiers were advertised but unreachable, and the `max` tier of
   `deepseek-v4-pro` never reached the gateway.
2. **The catalog advertised a tier set the request could not honour.** The
   `deepseek-v4-pro`, `deepseek-v4-flash` and `deepseek-v4-flash-vision-exp`
   rows fell through to the generic `deepseek` format set (`none`, `high`),
   while the upstream catalog declares `none`, `low`, `high`, `max`.
3. **A tier the model does not declare was still forwarded.** `medium`,
   `xhigh` and `minimal` were rewritten to `high` rather than folded onto the
   model's declared set, so the gateway received a tier it never advertised as
   supported.

The earlier port of the upstream catalog rows
(`port(omniroute): advertise supported OpenCode Go Flash efforts`, PR #2094,
commit `26197d82cf`) had aligned the advertised tiers for the two V4.1 Flash
ids only. It did not touch the request path, so the two surfaces still
disagreed.

## Fixed behavior

- `open-sse/providers/thinkingLevels.js` declares the OpenCode Go DeepSeek
  effort tiers once, in `OPENCODE_GO_DEEPSEEK_EFFORT_TIERS`, and exposes them
  through `getOpencodeGoEffortTiers(provider, model)`. The advertised catalog
  (`getThinkingLevels`, and therefore `thinking_levels` in `/v1/models`) and the
  request normalization read the same rows, so the two cannot drift apart. The
  declaration is scoped to the `opencode-go` provider and its `ocg` alias; the
  same model ids on any other gateway keep their own effort sets.
- `open-sse/translator/concerns/thinkingUnified.js` folds the requested tier
  onto the declared set before any lane renders it
  (`normalizeToDeclaredTiers`, `clampTierToSupported`): an accepted tier is
  forwarded verbatim, an undeclared tier is folded onto the nearest declared
  rung (the smallest declared tier at or above the request, else the highest
  declared tier), and a disable request on a model that declares no `none`
  tier is floored onto the lowest declared tier instead of switching thinking
  off.
  A reasoning request is never folded onto `none`, so an unrecognized tier
  becomes the lowest reasoning tier (`low`), not `none`. A declared set with
  no reasoning tier (`["none"]`) rejects reasoning requests with HTTP 400
  (#2648); no OpenCode Go row declares such a set.
- The `deepseek` wire branch forwards the resolved tier for those rows, so the
  OpenAI chat lane, the Claude Messages lane
  (`output_config.effort`) and the Responses lane (`reasoning.effort`) all
  carry the rung the catalog advertises.

Accepted tiers reach the wire unchanged (`none`, `low`, `high`, `max` for the
three older rows; `low`, `high`, `max` for the two V4.1 Flash ids). Rejected
tiers are folded onto a declared rung and never reach the wire as sent:
`minimal` becomes `low`, `medium` becomes `high`, `xhigh` and `ultra` become
`max`, and `none` becomes `low` on the two rows that cannot disable thinking.

## Compared and deliberately not changed

- **Other OpenCode providers.** The OpenCode free lane (`opencode`) and
  OpenCode Zen (`opencode-zen`) keep their own effort sets, including the
  `deepseek-v4.1-flash-free` low/high/max contract on the OpenCode Zen free
  route. The declaration is provider-scoped, so nothing else moved.
- **The same model id routed elsewhere.** The native DeepSeek provider keeps
  `none | high | max` for `deepseek-v4-pro` and the dotted `low..max` range
  for `deepseek-v4.1-flash`, and CodeBuddy CN keeps its own DeepSeek sets.
  Their requests are unchanged.
- **The `thinking` marker.** The OpenCode Go chat lane keeps the
  `thinking: {type}` marker it already sent. Only the effort tier carried in
  `reasoning_effort` changed, so no request shape was rewritten.
- **Model registration.** No model id was added to or removed from the OpenCode
  Go registry. `deepseek-v4.1-flash` and `deepseek-flash` are discovered from
  the live catalog, exactly as before; the declaration only pins their effort
  tiers.

## Limits

- No live verification. No OpenCode Go endpoint was called, no credential was
  used, and no browser, Docker, e2e or paid API was involved. The tiers are
  taken from the pinned upstream catalog, not from a live probe.
- The evidence test drives the catalog builder and the request normalizer with
  synthetic values and offline fixtures. It does not exercise the OpenCode Go
  relay, so it cannot prove which tiers the relay accepts today.
- `deepseek-v4.1-flash` and `deepseek-flash` are not static registry rows, so
  the catalog assertion covers the three served rows directly and the two
  discovered ids through the shared declaration and the request path.
