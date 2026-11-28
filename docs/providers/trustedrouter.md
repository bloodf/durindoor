---
title: TrustedRouter
description: Connect a TrustedRouter API key and discover chat and embedding models.
---

# TrustedRouter

Create an API key at [TrustedRouter](https://trustedrouter.com/console/api-keys).
In the dashboard, add a **TrustedRouter** provider connection, paste the key,
and test and save it. Refresh the connection's models to discover visible chat
models and their context, output, vision, tools and reasoning metadata.

Use the complete provider-qualified ID, for example
`trustedrouter/anthropic/claude-sonnet-4.6`. Vendor prefixes remain part of the
upstream model ID. Presets also have an upstream prefix:
`trustedrouter/trustedrouter/auto` selects the `trustedrouter/auto` preset.
Direct vendor connections remain separate.

Chat uses `https://api.trustedrouter.com/v1/chat/completions`. Embeddings use
`https://api.trustedrouter.com/v1/embeddings`, for example with
`trustedrouter/openai/text-embedding-3-small`. Nine embedding models and twelve
chat fallback models are included. Discovery filters out hidden, internal,
synthetic and non-chat catalog rows. A discovery outage leaves the curated
registry available; refresh again when the service recovers.

Connection testing calls the authenticated `/v1/key` endpoint. The public
`/v1/models` endpoint cannot establish whether a key is valid. Rejected keys
must be replaced; service outages should be retried. Credential-bearing requests
use fixed HTTPS endpoints and do not follow redirects or connection URL overrides.

The port was verified with offline fixtures. Provider availability and advertised
privacy guarantees have not been verified by DurinDoor.
