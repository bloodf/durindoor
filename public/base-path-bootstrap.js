/* Prefix browser API requests before dashboard components mount. */
(() => {
  const basePath = document.currentScript?.dataset.basePath;
  if (!basePath) return;
  const prefix = (input) => {
    const value = input instanceof Request ? input.url : String(input);
    let url;
    try { url = new URL(value, window.location.href); } catch { return input; }
    if (url.origin !== window.location.origin || !/^\/(api|v1|v1beta|i18n)(\/|$)/.test(url.pathname)) return input;
    url.pathname = basePath + url.pathname;
    return input instanceof Request ? new Request(url, input) : url.href;
  };
  const nativeFetch = window.fetch;
  window.fetch = (input, init) => nativeFetch.call(window, prefix(input), init);
  const NativeEventSource = window.EventSource;
  window.EventSource = class extends NativeEventSource {
    constructor(url, options) { super(prefix(url), options); }
  };
})();
