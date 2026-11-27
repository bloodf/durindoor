# TTOken staging — Refs #2034

Staged only: nothing here is registered, and TTOken cannot be added by a user yet.

Source: MIT-licensed cheaper-inference/OmniRoute PR #21441 (open when staged), head
`7ec5270551bdda0c0a692c7aea9b9ee0fd0ccc77`. Files carried over:
`open-sse/config/providers/registry/ttoken/index.ts`,
`src/shared/constants/providers/apikey/ttoken.ts`,
`src/app/api/providers/[id]/models/discovery/providerSets.ts`.

## What is verified

`tests/unit/native-ttoken-provider.test.js` injects the staged definition and runs production code with a mocked
transport and synthetic keys. It covers this router's behaviour only.

Unverified, and not to be restated as fact:

- The author's live checks. The author discloses working on TTOken, and the PR text dates one check 2026-11-28,
  after this staging date (2026-11-27).
- Everything about the upstream wire: auth, error bodies, per-key lists, the wrong-product 403, image support, and
  the rejection of images on native `/v1/messages` and `/v1/responses`. `https://ttoken.dev` and `/docs` returned
  only a page title to a plain fetch.
- Whether the seed `ttoken/auto` is an upstream id or a router-prefixed one.

## Registration (register-native-19)

Slots, in order. Items 2 to 5 are prerequisites: do not register without them.

1. **Registry.** Create `open-sse/providers/registry/ttoken.js` with `config.js` as its default export. Add no
   `executor`, `transports`, `oauth`, `priority`, pricing or free-tier field. Then run `pnpm run gen:registry-index`,
   `pnpm run gen:agent-index` and `pnpm run gen:provider-catalog`.
2. **Probe quirk.** Add `quirks: { validationChatFallback: false }` to `transport`. Without it a 429, 3xx or 5xx from
   `/v1/models` makes key validation send a chat completion, which a prepaid balance pays for.
3. **Connection discovery.** In `src/app/api/providers/[id]/models/fetchConnectionModels.js`, after `proxyOptions` is
   resolved and before the `PROVIDER_MODELS_CONFIG` lookup:

   ```js
   if (connection.provider === "ttoken") return discoverTtokenModels(connection, { signal, proxyOptions });
   ```

   Import it from `open-sse/services/providerParity/native-ttoken/index.js`. Do not use `customResolver`: it receives
   no abort signal. The generic fallback sets no `redirect` or `cache` and ignores the caller's signal.
4. **Connection-scoped catalogs.** Add `"ttoken"` to `CONNECTION_SCOPED_SYNC_PROVIDERS` in
   `src/lib/modelAutoSync/connectionScope.js`. Otherwise auto-sync stores the first connection's list provider-wide,
   and `/v1/models` can show it to an API key scoped to a different connection. Check any test that pins that list.
5. **Positive tests.** Replace the `TTOken staging-only state` block with positive assertions and drop the map
   injection. Add: `/v1/models` publishes the literal seed as `ttoken/ttoken/auto`; a key scoped to connection B never
   sees connection A's ids; existing bare-id routing is unchanged.

Already correct with the staged shape, no change needed: `DefaultExecutor` with OpenAI translation; first-slash
parsing; key validation and connection test through `probeRegistryProvider`; the `/v1/models` live lane (manual
redirect, `no-store`, cache keyed by key). That live lane has its own 5s deadline and takes no caller signal.

Exports from `index.js`: `TTOKEN_PROVIDER` (the registry entry) and
`discoverTtokenModels(connection, { signal, proxyOptions, fetchImpl })`, which returns
`{ provider, connectionId, models, source: "provider_api" }` or `{ error, status }`. `registration.json` records the
initial staging and lists only the first export.

## Behaviour to decide or document

- **Images.** The four vendor seeds pass image blocks through. `ttoken/auto` and ids the capability tables do not
  know have images replaced by a text placeholder. Do not declare vision for them without evidence.
- **403.** It stays `permission_error` with no quota evidence, and benches the account on the generic 403 cooldown.
  If upstream also answers 403 for a model one key may not run, routing needs a provider rule; unverified.
- **Exhausted balance.** Its status and wording are unknown. Add no TTOken quota rule yet.
- **Several keys.** `/v1/models` lists one connection per provider, and account selection does not filter by each
  key's list.
- **Retries.** The shared retry policy resends a chat request on 502, 503 and 504.
- **Suggested models.** The dashboard's anonymous catalogue read will find nothing if upstream requires a key, and is
  never key verification.
- The source also sets color `#FFB21A`; it is optional. The text icon `TT` is enough, so add no logo.

## User docs plan

Publish with registration, under `docs/providers/`:

1. Create a Gateway product API key at `https://ttoken.dev/dashboard/keys` and add it as an API-key connection.
2. OpenAI and Anthropic clients both work; the router sends everything to the chat completions lane.
3. Model ids keep their vendor prefix: `ttoken/deepseek/deepseek-v4.1-flash`. The seeded auto entry is
   `ttoken/ttoken/auto`; `ttoken/auto` sends `auto`. Say that which one upstream accepts is not verified.
4. The model list depends on the key. The seed list is an offline default and proves nothing about a key.
5. Errors: 401 key rejected; 403 key refused (check the Gateway product), which is not a quota message; 429 rate
   limit; 5xx upstream unavailable.

State no free tier, price, Rupiah conversion or gated model.
