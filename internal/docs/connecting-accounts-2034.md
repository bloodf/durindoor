

## Public guide provenance before main integration

DurinDoor follows the [pinned OmniRoute transport](https://github.com/cheaper-inference/OmniRoute/blob/bd9b1324abb82f0e00066f631b6dd7744e5d975a/open-sse/config/providers/registry/codebuddy-intl/index.ts) for the International chat endpoint, conversation headers and upstream streaming. DurinDoor aggregates the stream for non-streaming clients. The gateway transport has been tested with mocks. Save the key and use a chat request to check it, since the dashboard has no separate validation probe. The curated model list is a fallback and availability varies by account. International OAuth, token refresh, account-specific model discovery and quota reporting are unavailable.
