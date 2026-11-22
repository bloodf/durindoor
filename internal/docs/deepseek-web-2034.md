

## Public guide provenance before main integration

DeepSeek Web connects to the first-party chat API at [chat.deepseek.com](https://chat.deepseek.com). The pinned OmniRoute implementation (release/v3.8.55, `open-sse/executors/deepseek-web.ts`) authenticates with the `userToken` held in browser local storage. A browser Cookie header alone is not a supported credential; the API exchanges the userToken for a short-lived access token.

- [OmniRoute provider entry](https://github.com/cheaper-inference/OmniRoute/blob/4265bb2ad5477450a07d3a43ea33a62c6c874878/open-sse/config/providers/registry/deepseek/web/index.ts)

- [OmniRoute executor](https://github.com/cheaper-inference/OmniRoute/blob/4265bb2ad5477450a07d3a43ea33a62c6c874878/open-sse/executors/deepseek-web.ts)
