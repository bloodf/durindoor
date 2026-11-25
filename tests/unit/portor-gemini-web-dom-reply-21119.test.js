// The browser is scripted and its page is a local happy-dom document: no Google
// account, cookie, Chromium or network request is involved.
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { chromium } from "playwright";
import { Window } from "happy-dom";
import { readGeminiDomReply, toInPageExpression, waitForGeminiDomReply } from "../../open-sse/executors/gemini-web-dom.js";
import { GeminiWebExecutor, resetGeminiBrowserLeaseForTests } from "../../open-sse/executors/gemini-web.js";

const COOKIE = "__Secure-1PSID=psid-test; __Secure-1PSIDTS=ts-test";
const STREAM_URL = "https://gemini.google.com/_/BardChatUi/data/x/StreamGenerate";
const SIGN_IN = '<a data-test-id="mode-picker-sign-in-button">Sign in</a>';
const answer = (html, busy = false) =>
  `<model-response><message-content><div class="markdown" aria-busy="${busy}">${html}</div></message-content></model-response>`;

function documentOf(html) {
  const window = new Window();
  window.document.body.innerHTML = html;
  return window.document;
}
const markdownOf = (html) => readGeminiDomReply(documentOf(answer(html))).text;
const runInPage = (expression, document) => new Function("document", `return ${expression};`)(document);

const world = {};
function script(overrides = {}) {
  Object.assign(world, {
    html: "", afterEnter: () => `<user-query></user-query>${answer("<p>from the page</p>")}`,
    enterPresses: 0, droppedEnters: 0, detachedClicks: 0, clicks: 0, network: null, onToggle: null,
  }, overrides);
}

const launch = vi.spyOn(chromium, "launch").mockImplementation(async () => ({
  isConnected: () => true,
  close: async () => {},
  newContext: async () => ({
    addCookies: async () => {},
    cookies: async () => [],
    close: async () => {},
    newPage: async () => {
      const document = documentOf(world.html);
      let onResponse = null;
      return {
        on: (event, handler) => { if (event === "response") onResponse = handler; },
        url: () => "https://gemini.google.com/app",
        goto: async () => {},
        evaluate: async (expression) => runInPage(expression, document),
        waitForSelector: async () => ({
          click: async () => {
            world.clicks++;
            if (world.detachedClicks-- > 0) throw new Error("Element is not attached to the DOM");
            if (world.onToggle) document.body.insertAdjacentHTML("beforeend", world.onToggle);
          },
          textContent: async () => "Gemini 3.7 Flash",
        }),
        keyboard: {
          insertText: async () => {},
          press: async () => {
            world.enterPresses++;
            if (world.droppedEnters-- > 0) return;
            document.body.insertAdjacentHTML("beforeend", world.afterEnter());
            if (world.network) await onResponse({ url: () => STREAM_URL, ...world.network });
          },
        },
        // Response-length waits stay pending long enough for the DOM answer to
        // settle; short polls only yield, with the clock advanced by hand.
        waitForTimeout: async (ms) => {
          if (ms >= 1000) return new Promise((resolve) => setTimeout(resolve, 1500));
          vi.advanceTimersByTime(ms);
          await new Promise((resolve) => setImmediate(resolve));
        },
      };
    },
  }),
}));

async function run(model = "gemini-3.1-pro") {
  vi.useFakeTimers({ toFake: ["Date"] });
  const { response } = await new GeminiWebExecutor().execute({
    model, stream: false, credentials: { apiKey: COOKIE }, body: { messages: [{ role: "user", content: "hello" }] },
  });
  return { status: response.status, body: await response.json() };
}

afterEach(async () => {
  vi.useRealTimers();
  await resetGeminiBrowserLeaseForTests();
});
afterAll(() => launch.mockRestore());

describe("OmniRoute #21119 - Gemini Web answer read from the rendered page", () => {
  it("rebuilds Markdown and keeps code byte-exact", () => {
    const code = '{\n  "a":   1,\n\n\n  "b": "```"\n}';
    expect(markdownOf(
      '<h2>Title</h2><p>A <b>bold</b> and <i>soft</i> <code>x  =  1</code> <a href="https://example.com/">link</a></p>' +
      '<ul><li>one<ul><li>nested</li></ul></li><li><p>two</p></li></ul><ol start="3"><li>three</li></ol>' +
      '<blockquote><p>quoted</p></blockquote><table><tr><th>k</th></tr><tr><td>a|b</td></tr></table>' +
      `<response-element><code-block><div class="code-block-decoration"><span>JSON</span><button>copy</button></div><pre><code>${code}\n</code></pre></code-block></response-element>`,
    )).toBe([
      "## Title", "A **bold** and *soft* `x  =  1` [link](https://example.com/)", "- one\n  - nested\n- two", "3. three",
      "> quoted", "| k |\n| --- |\n| a\\|b |", `\`\`\`\`json\n${code}\n\`\`\`\``,
    ].join("\n\n"));
  });

  it("runs the serialized reader against a bare page document", () => {
    const snapshot = runInPage(toInPageExpression(readGeminiDomReply),
      documentOf(`<user-query></user-query>${answer("<p>hi</p>", true)}`));
    expect(snapshot).toEqual({ queries: 1, responses: 1, busy: true, text: "hi" });
  });

  it("waits for a newer answer that is finished and unchanged", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const old = { responses: 1, busy: false, text: "previous" };
    const frames = [old, { responses: 2, busy: true, text: "par" }, { responses: 2, busy: false, text: "part" }];
    const final = { responses: 2, busy: false, text: "complete" };
    let polls = 0;
    const page = {
      evaluate: async () => frames[polls++] ?? final,
      waitForTimeout: async (ms) => { vi.advanceTimersByTime(ms); },
    };
    expect(await waitForGeminiDomReply(page, { baselineResponses: 1, timeoutMs: 60_000 })).toBe("complete");
    expect(polls).toBeGreaterThan(frames.length + 3);
    polls = 0;
    const stale = { evaluate: async () => old, waitForTimeout: page.waitForTimeout };
    expect(await waitForGeminiDomReply(stale, { baselineResponses: 1, timeoutMs: 5000 })).toBe("");
  });

  it("answers from the page when no StreamGenerate response arrives", async () => {
    script({ html: `<user-query></user-query>${answer("<p>previous turn</p>")}` });
    const { status, body } = await run();
    expect(status).toBe(200);
    expect(body.choices[0].message.content).toBe("from the page");
    expect(world.enterPresses).toBe(1);
  });

  it("presses Enter once more when the prompt was dropped", async () => {
    script({ droppedEnters: 1 });
    expect((await run()).status).toBe(200);
    expect(world.enterPresses).toBe(2);
  });

  it("re-queries a composer that was re-rendered before the click", async () => {
    script({ detachedClicks: 2 });
    expect((await run()).status).toBe(200);
    expect(world.clicks).toBe(3);
  });

  it("keeps an upstream 429 as a quota error without waiting on the page", async () => {
    script({ afterEnter: () => "<user-query></user-query>", network: { status: () => 429, text: async () => "" } });
    const { status, body } = await run();
    expect(status).toBe(429);
    expect(body.error.code).toBe("gemini_web_quota_exceeded");
  });

  it("falls through to the page when the StreamGenerate body is unreadable", async () => {
    script({ network: { status: () => 200, text: async () => "not a frame" } });
    expect((await run()).body.choices[0].message.content).toBe("from the page");
  });

  it.each([
    ["on load", { html: SIGN_IN }, "gemini-3.1-pro"],
    ["once the mode menu opens", { onToggle: SIGN_IN }, "gemini-3.7-flash"],
  ])("reports a signed-out page %s as 401", async (_label, page, model) => {
    script(page);
    const { status, body } = await run(model);
    expect(status).toBe(401);
    expect(body.error).toMatchObject({ type: "authentication_error", code: "gemini_web_signed_out" });
    expect(world.enterPresses).toBe(0);
  });
});
