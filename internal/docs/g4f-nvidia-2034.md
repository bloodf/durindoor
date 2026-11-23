

## Public guide provenance before main integration

This is g4f's hosted NVIDIA NIM proxy, separate from NVIDIA's direct API. It uses OpenAI-compatible chat and model-list endpoints at `https://g4f.space/api/nvidia/v1`. OmniRoute's pinned catalog includes Nemotron 3 Nano, GLM 5.2, and MiniMax M2.7. g4f's [API documentation](https://g4f.dev/docs/ready_to_use.html) says this provider URL does not require a key; anonymous use may require proof-of-work credits. An optional g4f member key can be entered in the API key field.

Sources: [g4f API endpoints](https://g4f.dev/docs/ready_to_use.html), [OmniRoute registry at 4265bb2](https://github.com/cheaper-inference/OmniRoute/blob/4265bb2ad5477450a07d3a43ea33a62c6c874878/open-sse/config/providers/registry/g4f-nvidia/index.ts).
