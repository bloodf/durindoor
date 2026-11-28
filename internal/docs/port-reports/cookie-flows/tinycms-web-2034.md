# TinyCMS Web capture and import (#2034)

**Status: NOT VERIFIED.** The focused integration test is written but could not run in this checkout because dependencies are absent. Its assertions must pass in the isolated native gate before this can be called evidence of runtime behavior. No live sign-in or provider request was performed.

The real registry describes `https://site.tinycms.xyz` and one required localStorage item, `app-config-uuid`, matching `^R[\x21-\x7e]{3,}$`. It declares no cookies, chunks or optional cookie fields. The import stores the item in `providerSpecificData`; the executor uses it when a pasted API key is absent. The executor is registered and has a request path: public-IP lookup, challenge, signing and chat. This is an active provider rather than a capture-disabled staging profile. These are local source observations, not evidence of a live provider contract.

Existing `api/provider-cookie-import-local-storage.test.js` covers real pairing, create/update, validation, redaction and wrong ownership; `cookie-capture-local-storage-origin.test.js` covers navigation and origin checks using a constructed pairing. `tinycms-web-provider.test.js` covers executor and gateway calls with synthetic pasted keys. The new test joins an actual pairing to extension selection and capture, the import handler, SQLite storage and the executor with synthetic responses. It also exercises selected update ownership and account isolation, and runs the actual parser and contract on Cookie, cURL and HAR input. Those formats carry cookies rather than localStorage and the candidate builder refuses them; HAR's current error may say there is no request to the origin even when the matching request has no approved cookie. The API already rejects cookies beside or instead of this item in the existing localStorage suite. Cookie expiration has no applicable TinyCMS cookie to evaluate; pairing expiry and tab navigation are bounded in the extension, with navigation covered by the existing suite. The localStorage value itself has no expiry metadata, so expiration can only be established by a provider probe, not by capture.

The test mocks management authority, browser APIs and external fetch. The SQLite adapter, registry, parser, handlers, storage and executor are real. The capture test uses one synthetic account and the default direct route; it does not prove proxy routing, real browser permission behavior, an upstream session, or live sign-in. Separate tests cover the invalid-input and redaction cases described above; this new test is not a substitute for running them. No upstream source claim or ported logic is introduced here.

Focused command attempted with a unique private `/var/tmp` HOME, DATA_DIR, TMPDIR and cache, empty inherited environment, explicit PATH/LANG/CI and a 300-second timeout:

```sh
node tests/node_modules/vitest/vitest.mjs run tests/unit/cookie-flow-tinycms-web-2034.test.js --config tests/vitest.config.js --maxWorkers=2
```

Result: `MODULE_NOT_FOUND` for `tests/node_modules/vitest/vitest.mjs`; no tests collected. No dependency installation was attempted. `node --check tests/unit/cookie-flow-tinycms-web-2034.test.js` passed. The remaining owner requirement is to run and review the focused test in the native isolated dependency gate, including its executor boundary and redaction assertions, before treating the flow as proved.
