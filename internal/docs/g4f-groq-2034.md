# g4f Groq provider evidence (#2034)

## Public guide provenance before main integration

OmniRoute release/v3.8.55 lists `g4f-groq` at `https://g4f.space/api/groq/v1`. The g4f public API documentation identifies `https://g4f.space/api/groq` as its Groq provider. A single unauthenticated request to the pinned model-list endpoint `https://g4f.space/api/groq/v1/models` returned HTTP 404 on 2026-11-21 (Cloudflare address `172.67.169.115`). Per the work-order dead-upstream rule, this route is not implemented. This is endpoint evidence at the recorded time, not a claim that the entire g4f service is unavailable.

Sources: [g4f API endpoints](https://g4f.dev/docs/ready_to_use.html), [OmniRoute registry at 4265bb2](https://github.com/cheaper-inference/OmniRoute/blob/4265bb2ad5477450a07d3a43ea33a62c6c874878/open-sse/config/providers/registry/g4f-groq/index.ts).
