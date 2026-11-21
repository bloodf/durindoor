---
title: ChatGPT plan (owner-operated)
description: Connect an owner-operated ChatGPT plan on a local or self-hosted runtime.
---

This connection is for the runtime owner's own account. It is disabled by default and is separate from OpenAI Codex and ChatGPT Web. It is not a managed subscription or a shared paid routing service.

Set `DURINDOOR_CHATGPT_PLAN_ENROLLMENT=1` on the owner-controlled runtime and restart it. From an authenticated local dashboard session, use same-origin requests to `/api/oauth/chatgpt-plan/enrollment`. Create an inactive connection with `{"action":"create","name":"Owner plan"}`, then start sign-in with `{"action":"start","connectionId":"<id>"}`. Open the returned authorization URL privately on that machine and poll `{"action":"status","attemptId":"<id>"}` until complete. Enable the connection and explicitly scope a gateway API key to it. Use that scoped key to discover and call `chatgpt-plan/<model>`; the model picker asks for the scoped key and selected connection when loading this catalog. Do not share authorization URLs or credentials. An open dashboard alone does not authorize enrollment.

Reauthorize the same connection with `start`; use `signOut` with the connection ID to revoke its session, or explicitly set `localOnly` to clear local credentials without confirmed revocation. Disabling the environment flag stops plan enrollment, discovery, and dispatch. The local endpoint requires loopback, the existing origin check, and a dashboard session or CLI token.

For an owner-operated VM, use the private service's `detachForVm` and `bindFromOwnerTransfer` handoff: initialize a distinct persistent data directory and host identity on the destination, detach the source session, transfer the record over an authenticated secure channel, bind the verified account to the destination connection, and destroy temporary copies. Never put the transfer record or credentials in the public connection API. See the repository's `internal/docs/chatgpt-plan-oauth.md` for the complete procedure and recovery details.
