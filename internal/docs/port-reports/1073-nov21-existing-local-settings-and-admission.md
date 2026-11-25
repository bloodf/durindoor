# #1073: existing local settings and admission boundaries

## Scope and pins

Compared the exact OmniRoute PR head commits and their enclosing merge diffs against the current DurinDoor checkout at `7909dd23303ac138e56f0a3fbc65621033e256c7`.

- [OmniRoute #20820](https://github.com/cheaper-inference/OmniRoute/pull/20820), PR head `c28fec4e9f7193bea4730b9454107a5f1d79b58a`, enclosing merge `c8688bcd69d83cbe9b0a4adc3f536989ecbc1855`. The head itself renames the changelog fragment; the relevant PR patch is the first-parent diff of the enclosing merge. It changes vision-bridge guardrail self-loop identity and admission bypass ownership.
- [OmniRoute #20819](https://github.com/cheaper-inference/OmniRoute/pull/20819), PR head `035b02bcd111d013904b860c0743d011f37b7cd6`, enclosing merge `59bf5d718f3eaef0dc295f0419f43511b8405f2d`. The head itself renames the changelog fragment; the relevant PR patch is the first-parent diff of the enclosing merge. It adds operator-only local-corpus and WebDAV vault selection plus denied host-root validation.

## Local comparison and fixture evidence

DurinDoor has a local admission boundary, but not the same internal guardrail admission ownership as #20820. `open-sse/services/payloadAdmission.js` maintains process-wide active payload bytes, requests, held streams, a bounded queue, and timeouts. `tests/unit/payload-admission-lifecycle.test.js` covers byte estimation, bounded admission, single-release accounting, oversize rejection, queue shedding, timeout, and abort lifecycle. `tests/unit/admission-abort-race.test.js` checks that aborted requests do not dispatch and that gate slots are released. These fixtures establish resource admission behavior; they do not exercise a guardrail sub-request or an internal bypass identity.

DurinDoor's `src/sse/handlers/chat.js` Vision Bridge resolves model capabilities, checks the requested model and bridge target against the client's API-key model policy, then recursively handles the rerouted request with Vision Bridge disabled while retaining the API key and billing epoch. `tests/unit/vision-bridge-chat.test.js` records policy-before-capability/dispatch ordering and confirms target policy is checked. This is model rerouting within the existing request path, not an internal call back into the listener. No local `isInternalAdmissionBypass`, self-hop token, or `x-omniroute-admission-bypass` guardrail path was found.

The local corpus and WebDAV settings surfaces from #20819 are absent: there are no `src/app/api/settings/local-corpus` or `src/app/api/settings/obsidian/webdav` routes, no `deniedRootDirectories` equivalent, and no local corpus or Obsidian vault settings implementation under `src/`. The settings route inventory and source/test search found no such endpoints or fixture coverage. This is a feature-surface absence, not evidence that an equivalent validation control exists elsewhere.

## Dispositions

| PR | Disposition | Rationale |
|---|---|---|
| [#20820](https://github.com/cheaper-inference/OmniRoute/pull/20820) | No port indicated by the comparison | The upstream fix hardens a guardrail-created internal listener sub-request's ownership of an admission bypass. DurinDoor's Vision Bridge is a policy-checked reroute in the existing request path and has no corresponding guardrail self-loop bypass boundary. Local payload admission serves a different resource-bound purpose. No narrow parity gap was demonstrated. |
| [#20819](https://github.com/cheaper-inference/OmniRoute/pull/20819) | Not applicable to the current local surface | DurinDoor does not ship the local corpus root selector or Obsidian/WebDAV vault selector that the patch protects. The source comparison therefore demonstrates no installed route to which the upstream operator-auth or denied-root checks could be applied. |

No implementation is proposed. Since neither comparison demonstrates a narrow local gap, no new offline acceptance fixture is specified. Existing offline evidence is limited to the admission lifecycle/race and Vision Bridge routing fixtures listed above; no tests were run for this source-only report.
