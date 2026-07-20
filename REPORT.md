# ZenMux Free ctoken leak fix

## Problem

`open-sse/executors/zenmux-free.js` returned `url.toString()` in every success and error result. Because the URL is built with the `ctoken` cookie token as a query parameter, the token leaked into logs, error responses, and telemetry.

## Change

Added `redactedZenmuxUrl(url)` which copies the URL, deletes `ctoken` from the query string, and returns the redacted string. After `url.searchParams.set("ctoken", ctoken)` we compute `const resultUrl = redactedZenmuxUrl(url)`. All `result.url` return paths now use `resultUrl`, while `proxyAwareFetch(url.toString(), ...)` still sends the full URL to the wire.

### Before (representative)

```js
const url = new URL(ZENMUX_FREE_CHAT_URL);
url.searchParams.set("ctoken", ctoken);
...
return makeErrorResult(502, `...`, body, url.toString());
...
return {
  response: ...,
  url: url.toString(),
  ...
};
```

### After

```js
const url = new URL(ZENMUX_FREE_CHAT_URL);
url.searchParams.set("ctoken", ctoken);
const resultUrl = redactedZenmuxUrl(url);
...
return makeErrorResult(502, `...`, body, resultUrl);
...
return {
  response: ...,
  url: resultUrl,
  ...
};
```

The helper is:

```js
function redactedZenmuxUrl(url) {
  const redacted = new URL(url.toString());
  redacted.searchParams.delete("ctoken");
  return redacted.toString();
}
```

## Test

Added to `tests/unit/zenmux-free.test.js`:

```js
it("strips ctoken from result.url while still sending it to fetch", async () => {
  global.fetch.mockResolvedValueOnce(zenmuxSse(["ok"]));
  const exec = new ZenmuxFreeExecutor();

  const result = await exec.execute({
    body: { model: "deepseek/deepseek-chat", messages: [{ role: "user", content: "hi" }] },
    credentials: { apiKey: "ctoken=tok123" },
    stream: false,
  });

  const [fetchedUrl] = proxyAwareFetch.mock.calls[0];
  expect(fetchedUrl).toContain("ctoken=tok123");
  expect(global.fetch.mock.calls[0][0]).toContain("ctoken=tok123");
  expect(result.url).not.toContain("ctoken=");
  expect(result.url).toContain(ZENMUX_FREE_CHAT_URL);
});
```

## Out of scope

P0 #5 (`decodeURIComponent` outside try/catch) was left untouched per the separate PR instruction.
