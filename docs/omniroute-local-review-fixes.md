# OmniRoute local/router review fixes

Batch 5 review follow-ups keep local provider setup reachable from the dashboard.

- Local OpenAI-compatible providers and the embedded 9router entry are marked `noAuth`, so connections may be saved without an API key and empty bearer headers are not sent.
- The provider modal exposes a base URL field for optional local providers and stores overrides in `providerSpecificData.baseUrl`.
- Metadata-only `auto` remains visible as system metadata, but it is not exported into the static model catalog.
- OpenCode Zen uses model-family routing: Qwen Claude-format models go to `/messages`, GPT-5 models go to `/responses`, and the remaining OpenAI-format models stay on `/chat/completions`.
