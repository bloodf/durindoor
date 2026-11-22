

## Public guide provenance before main integration

- Only the key-exchange identity is ported. OmniRoute's Cursor CLI passthrough (`/api/cursor-cli/*`), its cursor-agent session manager and its Cursor image-generation handler are separate features and are not part of this provider.

- [OmniRoute Cursor registry, `cursor_apiProvider`](https://github.com/cheaper-inference/OmniRoute/blob/4265bb2ad5477450a07d3a43ea33a62c6c874878/open-sse/config/providers/registry/cursor/index.ts)

- [OmniRoute key exchange service](https://github.com/cheaper-inference/OmniRoute/blob/4265bb2ad5477450a07d3a43ea33a62c6c874878/open-sse/services/cursorApiKeyAuth.ts)

- [OmniRoute Cursor executor](https://github.com/cheaper-inference/OmniRoute/blob/4265bb2ad5477450a07d3a43ea33a62c6c874878/open-sse/executors/cursor.ts)

- [OmniRoute Cursor API key and CLI guide](https://github.com/cheaper-inference/OmniRoute/blob/4265bb2ad5477450a07d3a43ea33a62c6c874878/docs/providers/CURSOR-API-KEY-AND-CLI.md)
