# Deployment mode

`DEPLOYMENT_MODE=local` is the default. Set `DEPLOYMENT_MODE=hosted` (or `remote`) for a public deployment, including one behind a reverse proxy. Unknown values stop startup or reject requests. Hosted mode requires a writable `DATA_DIR`; mount persistent storage there. Storage errors never fall back to the local home directory.

Hosted mode requires credentials even when the proxy connects over loopback. It disables host-only routes, including IDE auto-import and local tunnel controls, and disables the fixed-port OAuth proxy. The OAuth dashboard uses the public callback except for providers that require a manual callback. A provider must allow the configured callback URI; fixed-URI provider registrations may reject a public callback.

Set `BASE_URL` and `NEXT_PUBLIC_BASE_URL` to the public origin when a reverse proxy rewrites Host. The existing origin checks use those operator-controlled values. The server strips client-supplied forwarding headers and does not trust them as proof of local access. Configure the proxy to preserve the public Host or use the configured origin; do not expose the application with local mode enabled.
