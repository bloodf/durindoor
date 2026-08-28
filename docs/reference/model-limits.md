# Model Limits and Context Enforcement

DurinDoor resolves a model's context window and maximum output through one
function so the router, the executors, and the public model APIs can never
disagree about a model's budget.

## The resolver

```js
import { resolveModelLimits } from "open-sse/providers/capabilities.js";

resolveModelLimits(provider, model);
// → { contextWindow: number, maxOutput: number, known: boolean, source: string }
```

`source` names the step that produced the numbers, in precedence order:

| `source` | Origin |
| --- | --- |
| `provider` | `PROVIDER_CAPABILITIES[provider][model]` — a provider-specific override. |
| `exact` | `MODEL_CAPABILITIES[model]` — a canonical exact-id row. |
| `registry` | The registry entry's own `contextLength` / `maxOutputTokens`. |
| `pattern` | The first matching `PATTERN_CAPABILITIES` glob. |
| `default` | Nothing matched; the values are the generic floor. |

Qwen3.8 and Meta Muse use ordered static rules. `qwen3.8-2.4t-*` stays text-only
at 262,144 tokens before the multimodal `qwen3.8-*` 1M rule; Muse Spark and
Glimmer likewise resolve before the generic Muse fallback. Exact CommandCode
Muse models keep their provider override, including `thinkingFormat: "commandcode"`.

### Why `known` exists

`DEFAULT_CAPABILITIES` carries `contextWindow: 200000` / `maxOutput: 64000`.
`getCapabilitiesForModel` merges that floor into every unmatched lookup, which
makes an unknown model indistinguishable from a genuine 200K model. Roughly a
third of the catalog resolves to that floor.

`resolveModelLimits` reports `known: false` for exactly those results. Callers
must treat an unknown limit as "no information", never as a fact:

- The model APIs omit the limit fields entirely rather than publishing a guess.
- The ingress preflight does not reject, no matter how large the request is.

A registry row only counts as evidence for the fields it actually declares.
Most registry entries carry no limits, so a row without a usable
`contextLength` falls through to the pattern chain instead of reporting
`known: true` with undefined numbers.

## Ingress context-limit preflight

`handleChatCore` runs a preflight after request shaping and immediately before
executor dispatch:

1. Resolve the model's limits. If `known === false`, skip the check entirely.
2. Compute the output reservation with
   `BaseExecutor.resolveEffectiveOutputReservation`.
3. Count the input tokens with `countInputTokens`, which calls the provider's
   native `/messages/count_tokens` endpoint when one exists and falls back to
   the heuristic estimate otherwise.
4. Reject locally when `input + reservation > contextWindow`.

Previously the estimate only fed compression planning, so an oversize request
was translated, compressed, and sent upstream purely to come back as a 400.

The rejection message contains `input is too long`, which
`isDeterministicPayloadError` already classifies as terminal. That keeps the
model-fallback chain from retrying a payload no other model would accept
either.

### Output reservation

`resolveEffectiveOutputReservation` returns exactly what
`clampCustomMaxOutput` will let through:

- An explicit client value (`max_tokens`, `max_completion_tokens`,
  `max_output_tokens`, or either Gemini `generationConfig.maxOutputTokens`
  shape), capped at the catalog `maxOutput`.
- The catalog `maxOutput` when the client names no output limit, since the
  provider will reserve it regardless.

The clamp and the preflight share this one value deliberately. If the preflight
charged the client's raw request while the clamp shipped the smaller capped
number, requests the provider would have accepted would be rejected locally.

## Surfacing limits to clients

- `GET /v1/models` (Codex projection) emits `context_window` and
  `max_output_tokens` for known models and omits both otherwise.
- `GET /v1/models/info` prefers the model's own registry declaration, then the
  resolver, so capability-only models — those whose limits come from a pattern
  or a provider override rather than a registry field — stop reporting no
  window at all.

Default/LLM combo entries expose the same flat `context_length` and
`max_completion_tokens` fields as individual models. Both values are the
smallest known limit across resolved members, including nested combos and
members referenced through static aliases or custom connection prefixes. This
is the largest limit every routable member can safely honor. Unknown member
limits are skipped; if every member is unknown, the field is omitted. Web
search and web fetch combos remain field-free because they are not chat models.

## Verified behavior

Confirmed against a dev server running this branch on an isolated port and data
directory, using a locally-created API-key connection (the upstream key was
deliberately invalid — the preflight runs before dispatch, so no provider call
is needed to observe it):

| Check | Result |
| --- | --- |
| `GET /v1/models` (Codex projection) | 1169 of 1335 models advertise `context_window` / `max_output_tokens`; the 166 unknown ones omit both. The currently deployed build advertises limits for **0** models. |
| `openai/gpt-5.4` in `/v1/models` | `context_window: 1050000`, `max_output_tokens: 128000`. |
| `GET /v1/models/info?id=openai/gpt-5.4` | `contextWindow: 1050000`, `maxOutput: 128000`. |
| `GET /v1/models/info?id=nr/auto` (unknown) | No limit fields at all, rather than the 200K floor. |
| Over-budget chat request (1.5M tokens to `openai/gpt-5.4`) | `HTTP 400` — `input is too long: 1501000 tokens required (1500000 input + 1000 output reservation) exceeds the 1050000-token context length of openai/gpt-5.4`. |
| Under-budget chat request, same model | Passes the preflight and reaches dispatch. |

### Client-side context configuration

There is no client-side context-window override to set: the omp agent config
(`~/.omp/agent/config.yml`) has no context-window or per-model limit key — its
`modelRoles` entries only name models. Client visibility therefore depends
entirely on what the server advertises, which is what the `/v1/models` and
`/v1/models/info` changes above provide.