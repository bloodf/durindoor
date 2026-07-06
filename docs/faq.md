# Frequently Asked Questions

## What is DurinDoor?

DurinDoor is a self-hosted AI gateway. It gives tools and applications one OpenAI-compatible endpoint while routing requests to many upstream providers.

## Is DurinDoor a model provider?

No. DurinDoor does not train or host foundation models by itself. It connects to providers, local model servers, compatible gateways, and media services that you configure.

## Why do some paths still say 9Router?

DurinDoor is a fork of 9Router. Some names remain for compatibility, especially the default data directory, legacy CLI alias, and some wire-format identifiers. This prevents avoidable migration breakage.

## What is the default port?

The production gateway and CLI default to `20128`. The source development server uses `20127` when running `npm run dev`.

## What base URL should clients use?

Most OpenAI-compatible clients should use:

```text
http://localhost:20128/v1
```

Use your HTTPS deployment URL instead of localhost for remote access.

## Which API key should I put in client tools?

Use a DurinDoor API key created in the dashboard. Do not put upstream provider keys directly into client tools unless you are bypassing DurinDoor.

## Can I use multiple providers at once?

Yes. Add multiple provider connections and create combos for ordered fallback. DurinDoor can also use multiple accounts for the same provider when configured.

## Can I use local models?

Yes. Add a local OpenAI-compatible or Anthropic-compatible provider node. When DurinDoor runs in Docker, configure the URL so the container can reach the local model server.

## Does DurinDoor support Claude-compatible clients?

Yes. DurinDoor exposes routes and translation logic for Claude-style requests. Claude Code usually uses `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN`.

## Does DurinDoor support the OpenAI Responses API?

Yes. DurinDoor includes `/v1/responses` and compatibility rewrites for responses-style clients. Provider support depends on the selected model and translator path.

## Does DurinDoor support audio, image, search, and embeddings?

Yes, DurinDoor includes routes for embeddings, image generation, image edits, speech, transcription, translation, web search, and web fetch. The selected provider must support the requested modality.

## What is a combo?

A combo is a named fallback chain. Clients send the combo name as the model, and DurinDoor tries each configured model in order.

## What is account fallback?

Account fallback is retrying another credential for the same provider and model. Combo fallback is trying another model in the combo chain.

## Is request logging safe?

Request logs can contain sensitive prompts, responses, filenames, URLs, or credentials if enabled too broadly. Keep detailed request logging off unless you are debugging and have permission to store that data.

## Can I expose DurinDoor publicly?

Yes, but use production controls: HTTPS, strong dashboard password, explicit secrets, restricted dashboard access, backups, and per-tool API keys.

## How do I migrate from 9Router?

Back up the existing data directory, start DurinDoor with the same or copied data directory, and verify providers, API keys, combos, and usage in the dashboard. Some compatibility names intentionally remain after migration.

## Where should translations come from?

Translations should come from `docs/`. Preserve file paths, headings, Markdown structure, code blocks, API paths, environment variables, and model identifiers.

## Where are all environment variables documented?

Use [Environment Variables](reference/environment.md). `.env.example` is the starter template; the reference page explains when and why to set each variable.

## How do I contribute?

Use [Contributing](development/contributing.md). Pull requests should normally target `dev`.
