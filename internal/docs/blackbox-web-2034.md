

## Public guide provenance before main integration

The pinned chat contract bootstraps `/api/auth/session`, optionally checks `/api/check-subscription`, then submits the OpenAI message history in Blackbox's `/api/chat` envelope. Responses are converted to OpenAI JSON or SSE chunks. The catalog currently lists the models in the pinned OmniRoute entry; account access and plan limits are controlled upstream. HTTP 401/403 indicate an invalid or expired session, 429 indicates rate limiting, and an in-band upgrade message maps to 402.

Tool calling is not advertised by the pinned catalog. Blackbox may change its web protocol or subscription behavior without notice. Source: [OmniRoute Blackbox Web registry at 4265bb2](https://github.com/cheaper-inference/OmniRoute/blob/4265bb2ad5477450a07d3a43ea33a62c6c874878/open-sse/config/providers/registry/blackbox/web/index.ts), [executor](https://github.com/cheaper-inference/OmniRoute/blob/4265bb2ad5477450a07d3a43ea33a62c6c874878/open-sse/executors/blackbox-web.ts).
