# Claude `stream_options` Transport Guard Design

## Problem

A streaming OpenAI-format client request routed to `claude/claude-opus-5` is correctly translated into an Anthropic Messages body. `DefaultExecutor.transformRequest()` then adds OpenAI Chat Completions' `stream_options: { include_usage: true }` to every streaming body containing `messages`. Anthropic rejects that field with `400 invalid_request_error: stream_options: Extra inputs are not permitted`.

## Design

Keep usage-option injection in `DefaultExecutor`, where upstream transport is resolved. Compute the effective transport as `credentials.runtimeTransport.format`, normalized by removing a trailing `-apikey`, with `this.config.format` as fallback. Add `stream_options` only when that effective format is exactly `openai`.

This preserves usage chunks for OpenAI-compatible streaming transports, prevents OpenAI-only fields from leaking into direct or runtime-selected Claude transports, and handles providers whose selected endpoint differs from their registry default.

## Tests

Extend `tests/unit/default-executor-stream-usage.test.js` with observable cases for:

- default OpenAI transport still receives `stream_options.include_usage`;
- direct Claude transport does not receive it;
- an OpenAI-default provider runtime-selected to Claude does not receive it;
- a Claude-default provider runtime-selected to OpenAI does receive it;
- the `openai-apikey` runtime suffix normalizes to OpenAI.

The failing Claude cases must be observed before production code changes. Focused tests, full no-regression suite, lint, docs, build, commitlint, and PR-title commitlint gate the fix.

## Scope

No provider-specific strip lists, translator changes, new abstraction, dependency, migration, or wire-format compatibility change.