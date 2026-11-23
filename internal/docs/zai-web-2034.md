

## Public guide provenance before main integration

Z.ai Web routes chat requests through the consumer service at [chat.z.ai](https://chat.z.ai). This connection uses the session token issued by the website, not a Z.ai API key. The provider was ported from OmniRoute `release/v3.8.55`, pinned at [`4265bb2`](https://github.com/cheaper-inference/OmniRoute/tree/4265bb2ad5477450a07d3a43ea33a62c6c874878), specifically `open-sse/config/providers/registry/zai-web/index.ts` and `open-sse/executors/zai-web.ts`.

The integration follows the pinned OmniRoute protocol for chat creation, signed completion requests, and SSE frames. Source references: [OmniRoute provider entry](https://github.com/cheaper-inference/OmniRoute/blob/4265bb2ad5477450a07d3a43ea33a62c6c874878/open-sse/config/providers/registry/zai-web/index.ts), [executor](https://github.com/cheaper-inference/OmniRoute/blob/4265bb2ad5477450a07d3a43ea33a62c6c874878/open-sse/executors/zai-web.ts), [protocol](https://github.com/cheaper-inference/OmniRoute/blob/4265bb2ad5477450a07d3a43ea33a62c6c874878/open-sse/executors/zai-web/protocol.ts), and [stream parser](https://github.com/cheaper-inference/OmniRoute/blob/4265bb2ad5477450a07d3a43ea33a62c6c874878/open-sse/executors/zai-web/stream.ts).
