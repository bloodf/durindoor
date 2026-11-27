# Notion Web cookie flow (#2034)

Status: **NOT PARITY — focused test not run locally**. This report describes repository behavior and proposed regression evidence, not a live sign-in or a verified upstream contract. No provider, browser, or real account was contacted.

The production registry entry at `open-sse/providers/registry/notion-web.js` declares `https://app.notion.com`, required `token_v2`, and extension capture. It declares no optional cookies, chunk prefixes, or localStorage keys. Its comment attributes the profile to OmniRoute `open-sse/config/providers/registry/notion-web/index.ts` at `4265bb2ad5477450a07d3a43ea33a62c6c874878`; that attribution is repository metadata, not an independent upstream comparison. No upstream source was inspected for this report.

Existing `provider-cookie-import-contracts.test.js` checks registry metadata; generic import suites use other providers or synthetic contracts. `notion-web-provider.test.js` exercises executor requests with credentials supplied directly. The new test connects the actual descriptor, extension selection, pairing handlers and SQLite repository, and passes the imported credential to the Notion executor using a synthetic proxy and network responses. It also covers pasted Cookie, cURL and HAR candidates, filtering, pairing authentication and one-use selection, replacement isolation, origin and expiration refusal, and response/header redaction. The allowlist rejects `token_v2.0`: this descriptor does not advertise chunked cookies. The parser drops `space_id`; the executor's existing `getSpaces` discovery supplies a workspace when the stored header has only `token_v2`.

The browser API, management guard authority, and provider network are mocked. SQLite migrations and connection repository, parser, provider descriptor, capture functions, import handlers and executor remain real. The test cannot establish actual browser permission behavior, real Notion response shapes, live authentication, or provider availability. It does not establish that every possible diagnostic path is secret-free. No product code or shared registration was changed.

The intended focused evidence command, from the repository root with isolated dependencies and private environment, is:

```sh
cd tests && node node_modules/vitest/vitest.mjs run unit/cookie-flow-notion-web-2034.test.js --maxWorkers=2
```

It was **not run**: root and test dependencies are absent in this checkout. No installation was attempted. The native gate must run the test and full required checks with its isolated dependencies before treating the proposed assertions as evidence. No product defect has been established by an executed reproduction in this unit.
