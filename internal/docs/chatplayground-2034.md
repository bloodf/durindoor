

## Public guide provenance before main integration

ChatPlayground uses the signed-in session cookie from `app.chatplayground.ai`. It does not use an API key. The pinned OmniRoute provider identifies `https://app.chatplayground.ai/api/models` for discovery and `https://app.chatplayground.ai/api/chat` for inference. ChatPlayground does not publish a reference for these web-app endpoints; the request envelope follows the pinned OmniRoute executor.

The pinned OmniRoute executor resolves a short-lived Clerk session token and chooses an upstream model endpoint from ChatPlayground's live catalog. Messages are limited to 15,000 characters each. Model availability and session expiration are controlled by ChatPlayground. The public site did not respond within the single unauthenticated 15 second probe on 2026-11-21; that timeout does not establish that the API is gone.

Sources: [OmniRoute registry](https://github.com/cheaper-inference/OmniRoute/blob/4265bb2ad5477450a07d3a43ea33a62c6c874878/open-sse/config/providers/registry/chatplayground/index.ts), [ChatPlayground](https://app.chatplayground.ai/).

## Superseded wire contract (OmniRoute #20375)

The guide above is historical. DurinDoor now uses the unified `web.chatplayground.ai/api` routes ported from [OmniRoute #20375](https://github.com/cheaper-inference/OmniRoute/pull/20375); see the [public guide](../../docs/providers/chatplayground.mdx). The upstream author reported checking that contract against the live site. DurinDoor tests it with closed mocks only.
