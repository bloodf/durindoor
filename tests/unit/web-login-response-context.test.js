import http from "node:http";
import vm from "node:vm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const config = vi.hoisted(() => ({ origin: "", startUrl: "", cookieNames: ["session"] }));
vi.mock("open-sse/providers/registry/index.js", () => ({ default: [{ id: "cookie-web", webLogin: config }] }));
import { beginSession, destroySession, proxyWebLoginRequest } from "../../src/lib/webLoginSession.js";

const LOGIN = "https://login.gateway.example";
let server, origin, sess, responseBody, contentType, setCookie, requests;

beforeEach(async () => {
  vi.stubEnv("BASE_URL", "https://gateway.example");
  vi.stubEnv("NEXT_PUBLIC_BASE_URL", "https://gateway.example");
  vi.stubEnv("DURINDOOR_WEB_LOGIN_ORIGIN", LOGIN);
  responseBody = "";
  contentType = "text/plain";
  setCookie = undefined;
  requests = [];
  server = http.createServer((req, res) => {
    requests.push({ path: req.url, cookie: req.headers.cookie });
    res.setHeader("content-type", contentType);
    if (setCookie) {
      res.setHeader("set-cookie", setCookie);
      setCookie = undefined;
    }
    res.end(responseBody);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  config.origin = origin;
  config.startUrl = `${origin}/login`;
  sess = beginSession("cookie-web", { loginOrigin: LOGIN, dashboardOrigin: "https://gateway.example" });
});
afterEach(async () => {
  destroySession(sess.id);
  await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
  vi.unstubAllEnvs();
});

function navigate(path) {
  return proxyWebLoginRequest(sess, new Request(`${LOGIN}/__web_login/cookie-web${path}`), `${origin}${path}`, LOGIN);
}

describe("upstream response URL contexts", () => {
  it("preserves executable JavaScript literals and arbitrary JSON data", async () => {
    contentType = "application/javascript";
    responseBody = 'function segments(pathname) { return pathname.split("/"); }';
    const script = await (await navigate("/app.js")).text();
    expect(vm.runInNewContext(`${script}; segments("/account/login").join("|")`)).toBe("|account|login");
    contentType = "application/json";
    const data = { delimiter: "/", pattern: "/not-a-url", nested: ["/", "//unchanged"] };
    responseBody = JSON.stringify(data);
    expect(await (await navigate("/data.json")).json()).toEqual(data);
  });

  it("rewrites HTML URL attributes and CSS URLs without corrupting embedded code or data", async () => {
    contentType = "text/html";
    responseBody = `<head><script src="/app.js"></script><style>.a{background:url('/image.png')} .b::after{content:"/"} /* url(/comment) */</style></head><a href='/account' title="href='/literal'">Account</a><form action=/login></form><script>function segments(pathname){return pathname.split("/");} const markup='<a href="/literal">';</script><script type="application/json">{"delimiter":"/"}</script><textarea><a href="/literal"></textarea>`;
    const html = await (await navigate("/login")).text();
    expect(html).toContain('src="/__web_login/cookie-web/app.js"');
    expect(html).toContain("href='/__web_login/cookie-web/account'");
    expect(html).toContain("action=/__web_login/cookie-web/login");
    expect(html).toContain("url('/__web_login/cookie-web/image.png')");
    expect(html).toContain('content:"/"');
    expect(html).toContain('title="href=\'/literal\'"');
    expect(html).toContain('pathname.split("/")');
    expect(html).toContain("const markup='<a href=\"/literal\">'");
    expect(html).toContain('{"delimiter":"/"}');
    expect(html).toContain('<textarea><a href="/literal"></textarea>');
    expect(html).toContain('/* url(/comment) */');
  });

  it("scopes native SVG and object resources without changing unrelated data attributes", async () => {
    contentType = "text/html";
    responseBody = '<svg><use xlink:href="/sprite.svg#icon"></use></svg><object data="/resource.svg"></object><div data="/literal"></div>';
    const html = await (await navigate("/login")).text();
    expect(html).toContain('xlink:href="/__web_login/cookie-web/sprite.svg#icon"');
    expect(html).toContain('<object data="/__web_login/cookie-web/resource.svg">');
    expect(html).toContain('<div data="/literal">');
  });

  it("scopes srcset candidates while preserving data URLs and density descriptors", async () => {
    contentType = "text/html";
    responseBody = '<img srcset="/challenge.png 1x,/challenge@2.png 2x"><img srcset="data:image/svg+xml,/literal 1x, /large.png 2x">';
    const html = await (await navigate("/login")).text();
    expect(html).toContain('srcset="/__web_login/cookie-web/challenge.png 1x,/__web_login/cookie-web/challenge@2.png 2x"');
    expect(html).toContain('srcset="data:image/svg+xml,/literal 1x, /__web_login/cookie-web/large.png 2x"');
  });

  it("rewrites standalone CSS URL tokens and imports but not strings or comments", async () => {
    contentType = "text/css";
    responseBody = '@import "/theme.css"; .a{background:url(/image.png)} .b{background:url("/second.png")} .c::after{content:"url(/literal)"} /* url(/comment) */';
    const css = await (await navigate("/style.css")).text();
    expect(css).toContain('@import "/__web_login/cookie-web/theme.css"');
    expect(css).toContain('url(/__web_login/cookie-web/image.png)');
    expect(css).toContain('url("/__web_login/cookie-web/second.png")');
    expect(css).toContain('content:"url(/literal)"');
    expect(css).toContain('/* url(/comment) */');
  });
});

describe("RFC cookie default-path at the upstream HTTP boundary", () => {
  it.each([
    ["/account/login", "session=captured", "/account", "/accounting"],
    ["/account/", "session=captured", "/account", "/accounts"],
    ["/account/deep/login", "session=captured", "/account/deep", "/account"],
    ["/login", "session=captured", "/", null],
    ["/account/login", "session=captured; Path=invalid", "/account", "/accounting"],
  ])("scopes a cookie from %s to its RFC directory", async (source, cookie, included, excluded) => {
    setCookie = cookie;
    await navigate(source);
    await navigate(included);
    expect(requests.at(-1)).toEqual({ path: included, cookie: "session=captured" });
    await navigate(`${included === "/" ? "" : included}/profile`);
    expect(requests.at(-1).cookie).toBe("session=captured");
    if (excluded) {
      await navigate(excluded);
      expect(requests.at(-1)).toEqual({ path: excluded, cookie: undefined });
    }
  });
});
