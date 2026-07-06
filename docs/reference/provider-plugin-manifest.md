# Provider Plugin Manifest

DurinDoor exposes a JSON-safe provider manifest at
`GET /api/v1/provider-plugin-manifest`. The manifest is generated from
`open-sse/providers/registry` and is intended for sidecars such as CLIProxyAPI
that need provider metadata without importing DurinDoor executor code.

The manifest includes provider IDs, aliases, wire format, executor name, auth
shape, static endpoints, model metadata, capability tags, and conservative
sidecar eligibility. It intentionally excludes OAuth secrets, dynamic URL
builder functions, request headers, and session pool internals.

Sidecars should treat `sidecar.eligible` as a candidate signal. Providers with
custom executors, OAuth/session flows, dynamic URLs, or pool config stay on the
JavaScript fallback path until the sidecar implements equivalent behavior.

CLIProxyAPI requests receive an `X-OmniRoute-Provider-Manifest-Url` header.
Set `OMNIROUTE_PROVIDER_MANIFEST_URL` when the sidecar needs a public URL
instead of the local DurinDoor origin.
