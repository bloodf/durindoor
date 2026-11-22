

## Public guide provenance before main integration

SYNTX is present in the pinned OmniRoute registry at `open-sse/config/providers/registry/syntx/index.ts` (release/v3.8.55, commit `4265bb2ad5477450a07d3a43ea33a62c6c874878`) and its executor is in `open-sse/executors/syntx.ts`. The registry points to `https://api.syntx.ai/api/v1`; the pinned executor routes chat through that API host.

Sources: [OmniRoute pinned registry](https://github.com/cheaper-inference/OmniRoute/blob/4265bb2ad5477450a07d3a43ea33a62c6c874878/open-sse/config/providers/registry/syntx/index.ts), [OmniRoute pinned executor](https://github.com/cheaper-inference/OmniRoute/blob/4265bb2ad5477450a07d3a43ea33a62c6c874878/open-sse/executors/syntx.ts), [SYNTX public help](https://docs.syntx.ai/en/%F0%9F%92%A1-Text/%F0%9F%92%A1-Text).
