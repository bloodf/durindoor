# Muse sign-in and Meta Model API routing (#2034)

## What was verified

The gateway reaches two different Meta vendors under two provider ids, and two
different Meta credentials reach the same host:

| Provider id | Alias | Host | Credential |
| --- | --- | --- | --- |
| `muse-code` | `mc` | `api.meta.ai` | Muse Code subscription key (minted from the device token) **or** Meta Model API key (pasted) |
| `meta-llama` | `meta` | `api.llama.com` | Meta Llama API key |

The verification was done with closed fixtures only: no live call, no
credential, no browser, no Docker. The evidence is
`tests/unit/meta-provider-id-collision.test.js`, run together with the three
pre-existing Muse Code suites (`unit/muse-code-oauth.test.js`,
`unit/muse-code-route.test.js`, `unit/muse-code-signin-parity.test.js`).

The name mapping, the provider ids and the stored connection identity are
unchanged. No provider was renamed, added or removed.

## The two Meta credentials are not interchangeable

Meta publishes two separate products, and the credential of one is not
accepted by the other.

**Meta Model API** — the documented public surface for external clients.
<https://dev.meta.ai/docs/overview> gives the base URL `https://api.meta.ai/v1`,
the auth `Bearer token (MODEL_API_KEY)` and the Responses endpoint
`POST /v1/responses`. The documented request carries only `Authorization` and
`Content-Type`; the API is described as drop-in compatible with the OpenAI
SDK, the Anthropic SDK and OpenAI-compatible agent CLIs. Model discovery is
`GET /v1/models`
(<https://dev.meta.ai/docs/api-reference/models/list-models>), which lists the
models that the calling key can use, so the listing is account-scoped.

**Muse Code subscription** — the coding agent CLI. The subscription help page
(<https://dev.meta.ai/help/subscriptions/subscribe-to-muse-code>) states:

> The subscription applies to the Muse Code API key that is automatically
> connected in the Muse Code CLI onboarding process. This credential is for use
> with Muse Code only. Any additional API keys you create under your Meta
> Model API account will be billed through pay-as-you-go.

So the subscription key is a Muse Code credential. It is not a general Model
API key, and a Model API key is not a Muse Code credential.

**Official CLI sign-in options**
(<https://dev.meta.ai/docs/muse-code/auth>): on first run the Muse Code CLI
offers *Sign in with your browser* (the device grant) or *Paste an API key*
(`META_API_KEY`, also `muse auth set`). An API key always takes priority over
a browser sign-in, `/login` reopens the choice, `muse logout` clears the stored
session and key, and Meta Managed Account (MMA) accounts cannot use the
browser flow at all and must use an API key.

### Gateway OAuth assumption, audited

The gateway's OAuth path reproduces the Muse Code CLI's own sign-in: an RFC
8628 device grant against `auth.meta.com` yields a durable `dca:` token, and
the inference key is minted from it at `https://api.meta.ai/muse-code/key`.
That is the CLI's own credential lifecycle, and the key it produces is a Muse
Code credential. The audit result:

- The assumption "the device grant yields a general-purpose Meta inference
  key" is **wrong**. It yields a Muse Code subscription key. The gateway
  therefore keeps it on the Muse Code client path, with the Muse Code client
  identity.
- The assumption "the gateway may send that key from any client" is **wrong**
  for the same reason. Meta scopes the credential to the Muse Code client.
- The supported path for an external client such as this gateway is a
  separately issued Meta Model API key on the documented endpoints. The
  gateway now sends that key exactly as documented: a bare bearer, no client
  fingerprint.
- A pasted Model API key is never reminted. It has no device token behind it,
  and there is nothing to remint from.

## What DurinDoor does now

**The Model API key path** (`open-sse/executors/muse-code.js`). When the
connection carries an API key, the request goes to
`https://api.meta.ai/v1/responses` with `Authorization: Bearer <key>` and no
Muse Code client fingerprint. `applyAuth` resolves `apiKey` before
`accessToken`, so the presence of an API key is exactly what decides which
credential is on the wire.

**The subscription path** is unchanged: a minted key keeps the Muse Code client
identity, is reminted from the stored `dca:` token when it is missing or
rejected, and is never minted from a pasted key.

**Bounded refusal** (`open-sse/handlers/chatCore.js`). Meta answers
`client_attestation_denied` when the credential is not entitled to the
requested surface. A key reminted from the same device token carries the same
scope, so the refusal is surfaced as it arrived: no remint, no substituted
credential, no second attempt. The gate is narrow — a plain `401` still
remints and retries once, exactly as before. The veto is an optional executor
hook (`shouldRefreshAfterAuthFailure`), so no other provider changes.

**Account-scoped discovery** (`src/app/api/providers/[id]/models/modelsConfig.js`).
`GET https://api.meta.ai/v1/models` with the connection's own key lists the
models that account can use. The request is a documented Model API call and
carries no Muse Code client fingerprint. The static catalog is unchanged, so
the picker and the static story evidence keep the same 13 rows. Two generated
artifacts follow from the new key, both by their own rules: the browser
fixture list that tracks `PROVIDER_MODELS_CONFIG` gained `muse-code`, and the
Storybook inventory manifest records the new digest of that story file, which
is what `scripts/sync-storybook-inventory.mjs` recomputes for every
dependency.

## Upstream comparison

Snapshots rechecked on 2026-11-20 from the public GitHub commits API:

| Upstream | Revision | Note |
| --- | --- | --- |
| CLIProxyAPI `main` | [`6faa8d20b2673404cff70a2f2d9537ae0d0e684d`](https://github.com/router-for-me/CLIProxyAPI/tree/6faa8d20b2673404cff70a2f2d9537ae0d0e684d) | Unchanged. Subject `fix(codex): strip uniqueItems keyword from tool parameter schemas`. |
| EasyCLIProxyAPI `main` | [`e4223d5eefa22a3301ca7e2a28d05897432b07f9`](https://github.com/router-for-me/EasyCLIProxyAPI/tree/e4223d5eefa22a3301ca7e2a28d05897432b07f9) | Unchanged. Subject `Prepare v0.3.112 release`. |
| OmniRoute `main` | [`d1821d0db11dcfe92c2cde3629f06aabecc133dc`](https://github.com/cheaper-inference/OmniRoute/tree/d1821d0db11dcfe92c2cde3629f06aabecc133dc) | Moved from the earlier snapshot `e3c1531afd07d5e06f7ffab658584a7ae2e3627e`. `src/lib/oauth/providers/muse-code.ts` is unchanged between the two revisions. |

### Cross-project name mapping

| Upstream (CLIProxyAPI) | EasyCLIProxyAPI | OmniRoute | DurinDoor |
| --- | --- | --- | --- |
| `meta` provider id (Muse device OAuth, `api.meta.ai`) | `meta`; `muse` normalizes to `meta` | `muse-code` | `muse-code` (alias `mc`) |
| `meta-api-key` config group (base `https://api.meta.ai/v1`) | "Meta API" API-key form, sharing the `meta` provider key | — | the API-key auth mode of `muse-code` |
| — | — | — | `meta-llama` (alias `meta`), `api.llama.com` |

The `meta` name means two different things upstream: the Meta Muse OAuth
identity on `api.meta.ai`, and a separate API-key group whose default base is
also `api.meta.ai`. DurinDoor keeps the Meta Llama API-key host `api.llama.com`
under the `meta` alias, so the `meta` alias in DurinDoor is **not** upstream's
`meta`. The Meta Muse vendor is reached only through `muse-code`. No duplicate
identity was added and `meta` was not reassigned.

### Contract comparison

| Aspect | CLIProxyAPI @ `6faa8d2` | OmniRoute @ `d1821d0` | DurinDoor | Match |
| --- | --- | --- | --- | --- |
| Device authorization URL | `https://auth.meta.com/oidc/device/authorization/` | same | same | yes |
| Device token URL | `https://auth.meta.com/oidc/device/token/` | same | same | yes |
| Device request body | form `client_id=1031625952748946` | same | same | yes |
| Auth-call User-Agent | `muse-code/1.0.2` | same | same | yes |
| Key mint URL | `https://api.meta.ai/muse-code/key` | same | same | yes |
| Mint request | `Authorization: Bearer <dca>`, body `{"dca_token": …}` | same | same | yes |
| Durable credential | the `dca:` token | the `dca:` token | the `dca:` token | yes |
| Remint trigger | missing key or `401` | missing key or `401` | missing key or `401` | yes |
| Config/API key is never reminted | `ShouldPrepareRequestAuth` returns false for a config API key | no device token behind it | no device token behind it | yes |
| API base | `https://api.meta.ai/v1` | `https://api.meta.ai/v1` | `https://api.meta.ai/v1` | yes |
| Responses URL | base + `/responses` | same | same | yes |
| Request Authorization | `Bearer <api_key>` | same | same | yes |
| Client identity on the subscription path | `muse-build/1.4.14 (non-interactive; …)` plus session headers, stamped on every request | — | `muse-build/1.3.0 …`, stamped on the subscription path only | differs, see below |
| Client identity on the API-key path | the CLI fingerprint is stamped on every request, including a config API key | — | **no fingerprint** — the documented Model API request | differs, see below |
| Model discovery | — | `GET /v1/models` merged with `GET /muse-code/models` metadata | `GET /v1/models` only | partial |
| Subscription quota | `429` with a subscription-quota body is credential-scoped | — | not implemented | open |
| Model ids | static `muse-*` set | live listing | static set plus `passthroughModels` | differs by design |

### The two deliberate differences

**The client identity on the Model API key path.** CLIProxyAPI stamps
`applyMetaClientIdentity(req)` on every request, including a config API-key
request (`internal/runtime/executor/meta_executor.go`). DurinDoor does not.
Meta documents the Model API for external clients, and a Model API key is not a
Muse Code credential, so there is nothing for a Muse Code fingerprint to
attest to. Sending one would put a client identity on a credential that does
not carry that client's scope.

**The attestation denial is not worked around.** Upstream answers the same
`client_attestation_denied` by matching a newer Muse Code build
(`muse-build/1.4.14`, `X-Client-Id: tbh:exec`, a fresh session id set), and
its own source notes that header parity alone does not satisfy attestation for
tool-bearing requests. DurinDoor does not adopt a newer fingerprint to get
past the check. A refused credential is a credential problem, so the gateway
reports it and stops: no remint, no substituted credential, no retry. The
supported answer is a Meta Model API key.

## Open deltas

- **Subscription-key attestation.** A Muse Code subscription key can still be
  refused by Meta. The gateway now reports that boundedly instead of retrying
  it. Making the subscription path work again would mean reproducing the Muse
  Code client's attestation surface, which is out of scope here.
- **Model discovery metadata.** OmniRoute merges the key-scoped `/v1/models`
  listing with the `/muse-code/models` catalog for limits, modalities and
  reasoning variants. DurinDoor reads only the documented `/v1/models`, so the
  discovery rows carry ids alone.
- **Subscription quota.** CLIProxyAPI classifies a `429` with a
  subscription-quota body as a credential-scoped failure. DurinDoor has no
  equivalent classification for `muse-code`.
- **Static catalog.** The `muse-code` catalog still lists the Meta Llama model
  names as Muse-side ids. They are routed under the `mc` namespace and never
  collide with the `meta` namespace, but they are not Model API model ids.
