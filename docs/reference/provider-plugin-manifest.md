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

CLIProxyAPI is optional. DurinDoor remains the fallback for providers whose auth, URL construction, session pooling, or executor behavior cannot be represented safely in the manifest.

CLIProxyAPI requests receive an `X-OmniRoute-Provider-Manifest-Url` header.
The header is derived only from trusted server configuration, never from
inbound request headers such as `Origin`. Set `OMNIROUTE_PROVIDER_MANIFEST_URL`
or a public `BASE_URL`/`NEXT_PUBLIC_BASE_URL` when the sidecar needs a public
URL instead of the local DurinDoor origin.
