

## Public guide provenance before main integration

This provider is **unverified**. Tests answer every call from a closed mock of the pinned contract. No live Devin account, token or model list has been run against it, and the upstream transport is undocumented: it still identifies itself as Windsurf, and the wire schema comes from the pinned OmniRoute port, not from a published API. Treat this page as the documented contract, not tested behavior.

- [Pinned OmniRoute registry entry](https://github.com/cheaper-inference/OmniRoute/blob/4265bb2ad5477450a07d3a43ea33a62c6c874878/open-sse/config/providers/registry/devin-desktop/index.ts) and [model catalog](https://github.com/cheaper-inference/OmniRoute/blob/4265bb2ad5477450a07d3a43ea33a62c6c874878/open-sse/config/providers/registry/devin/catalog.ts)

- [Pinned OmniRoute executor](https://github.com/cheaper-inference/OmniRoute/blob/4265bb2ad5477450a07d3a43ea33a62c6c874878/open-sse/executors/devin-desktop.ts)

- [Pinned OmniRoute sign-in](https://github.com/cheaper-inference/OmniRoute/blob/4265bb2ad5477450a07d3a43ea33a62c6c874878/src/lib/oauth/providers/devin-desktop.ts) and [OAuth constants](https://github.com/cheaper-inference/OmniRoute/blob/4265bb2ad5477450a07d3a43ea33a62c6c874878/src/lib/oauth/constants/oauth.ts)

- [Pinned OmniRoute model discovery](https://github.com/cheaper-inference/OmniRoute/blob/4265bb2ad5477450a07d3a43ea33a62c6c874878/open-sse/services/devinDesktopModels.ts)

- [Pinned OmniRoute token-refresh note (Devin is not refreshable)](https://github.com/cheaper-inference/OmniRoute/blob/4265bb2ad5477450a07d3a43ea33a62c6c874878/open-sse/services/tokenRefresh.ts)

Ported from OmniRoute (MIT).
