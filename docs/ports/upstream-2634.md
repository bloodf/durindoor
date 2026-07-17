# Port log: upstream 9router PR #2634

- **Source:** https://github.com/decolua/9router/pull/2634
- **Port branch:** `port/upstream-2634`
- **Base:** `origin/dev` at `d500ae7c9ce4a011e05ab724da15a8ab37c91462`

## Behavior ported

`collapseTextParts` flattens any non-empty text-only OpenAI content-part array
into a single string by joining the blocks with `\n`. Arrays that contain
non-text blocks (`image_url`, `tool_result`, etc.) are left unchanged so
multimodal content keeps its structure. This prevents providers from silently
truncating or rejecting repeated `[{type:text},{type:text}]` arrays.

## DurinDoor adaptation

The helper in `open-sse/translator/concerns/message.js` already implemented the
same flattening behavior locally; this port updates the comment to document the
multi-block intent and fixes a branch in `gemini-to-openai.js` that previously
short-circuited the helper for assistant tool-call content, returning the raw
array instead.

## Files (4)

- `open-sse/translator/concerns/message.js` — updated inline documentation
- `open-sse/translator/request/gemini-to-openai.js` — assistant tool-call branch now uses `collapseTextParts`
- `tests/translator/port-2634-flatten-multi-block-text.test.js` — regression: multi-block text flattened, multimodal arrays preserved, Gemini tool-call branch covered
- `docs/ports/upstream-2634.md` — this log

## Verification

Deferred to Main per assignment.
