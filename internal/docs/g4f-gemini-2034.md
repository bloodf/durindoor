

## Public guide provenance before main integration

This is g4f's hosted Gemini proxy, separate from Google's native Gemini API. Its OpenAI-compatible endpoints are `https://g4f.space/api/gemini/v1/chat/completions` and `/v1/models`. OmniRoute's pinned catalog lists Gemini 2.5 Flash and Pro. g4f's [API documentation](https://g4f.dev/docs/ready_to_use.html) says these provider URLs do not require an API key; anonymous use may require proof-of-work credits. An optional g4f member key can be entered in the API key field.

Sources: [g4f API endpoints](https://g4f.dev/docs/ready_to_use.html), [OmniRoute registry at 4265bb2](https://github.com/cheaper-inference/OmniRoute/blob/4265bb2ad5477450a07d3a43ea33a62c6c874878/open-sse/config/providers/registry/g4f-gemini/index.ts).
