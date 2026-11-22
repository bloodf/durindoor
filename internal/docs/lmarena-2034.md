

## Public guide provenance before main integration

Arena (formerly LMArena) exposes a browser-session chat flow, not a public API-key API. DurinDoor follows OmniRoute's pinned provider: `POST https://arena.ai/nextjs-api/stream/create-evaluation` with the `arena-auth-prod-v1` Supabase session cookie. Numbered cookie chunks (`arena-auth-prod-v1.0`, `.1`, …) are reconstructed in order.

- [OmniRoute pinned LMArena registry](https://github.com/cheaper-inference/OmniRoute/blob/4265bb2ad5477450a07d3a43ea33a62c6c874878/open-sse/config/providers/registry/lmarena/index.ts)

- [OmniRoute pinned LMArena executor](https://github.com/cheaper-inference/OmniRoute/blob/4265bb2ad5477450a07d3a43ea33a62c6c874878/open-sse/executors/lmarena.ts)
