# port(upstream): #2622 - literal think-marker leak fix

- **Source**: https://github.com/decolua/9router/pull/2622
- **Base**: origin/dev @ `d500ae7c9ce4a011e05ab724da15a8ab37c91462`
- **Scope**: `open-sse/translator/response/claude-to-openai.js`, `open-sse/translator/response/openai-responses.js`

## Behavior

`claude-to-openai.js` previously emitted literal `"<think>"` / `"</think>"` text chunks
in `delta.content` to delimit Claude thinking blocks. These markers are a private
convention only `openai-responses.js` understood; any external OpenAI consumer renders
them as visible text, and downstream proxies rebuilding Claude messages place a `text`
block before the `thinking` block, causing clients to silently drop the thinking content.

## Change

- `claude-to-openai.js`: thinking `content_block_start`/`content_block_stop` now only
  track internal state; no literal markers are emitted in `delta.content`.
- `openai-responses.js`: closes the reasoning section on the `reasoning_content` →
  `content` state transition, preserving the explicit "reasoning ended" event (#454)
  without leaking markers onto the wire.
- Inline `<think>` tag parsing inside `content` remains untouched for providers that
  genuinely emit such tags.

## Test

- `tests/translator/bugs-claude-thinking-tags.test.js` added; imports
  `./registerAll.js` per AGENTS §4.4 and runs with `--config tests/vitest.config.js`.

## Verification

Skipped per task request. Main will run the local gate and required checks before PR
creation/merge.
