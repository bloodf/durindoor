/**
 * Read Gemini Web's answer from the rendered page (OmniRoute #21119, issue #21116).
 *
 * Some accounts no longer receive the answer in a `StreamGenerate` response: the
 * app talks to `geminiweb-pa.clients6.google.com/v1/processSession` over a
 * WebChannel and only renders the result. The DOM is where every transport ends
 * up, so the newest finished `model-response` is turned back into Markdown.
 * Fenced code keeps its exact text, which callers asking for JSON rely on.
 *
 *   model-response > message-content > div.markdown[aria-busy]   the answer
 *     code-block > .code-block-decoration > span                 language label
 *                > pre > code                                    code text
 *   user-query                                                   one per submitted prompt
 *
 * Ported from OmniRoute open-sse/executors/gemini-web/domReply.ts. MIT.
 */
import { isFunction } from "../../src/shared/utils/typeChecks.js";

const SUBMIT_CONFIRM_MS = 5000;
const SUBMIT_POLL_MS = 250;
const REPLY_POLL_MS = 500;
const REPLY_STABLE_MS = 2000;

/**
 * Runs INSIDE the page (serialized with `toString()`), so it must stay
 * self-contained: no imports and no references to anything outside its body.
 * @param {Document} [doc] defaults to the page's document
 * @returns {{ queries: number, responses: number, busy: boolean, text: string }}
 */
export function readGeminiDomReply(doc) {
  const d = doc || document;
  const responses = d.querySelectorAll("model-response");
  const queries = d.querySelectorAll("user-query").length;
  const last = responses.length ? responses[responses.length - 1] : null;
  const panel = last ?
  last.querySelector("message-content .markdown") || last.querySelector("message-content") :
  null;
  if (!panel) return { queries, responses: responses.length, busy: false, text: "" };

  const SKIP = ["BUTTON", "GEM-ICON-BUTTON", "MAT-ICON", "SCRIPT", "STYLE", "SVG"];
  const INLINE = ["SPAN", "STRONG", "B", "EM", "I", "CODE", "A", "BR", "SUP", "SUB"];
  const BLOCK_CHILDREN = "p, pre, code-block, ul, ol, table, h1, h2, h3, h4, h5, h6, blockquote";
  const tagOf = (node) => node.nodeType === 1 ? node.tagName.toUpperCase() : "";

  const inline = (node) => {
    if (node.nodeType === 3) return (node.nodeValue || "").replace(/\s+/g, " ");
    const tag = tagOf(node);
    if (!tag || SKIP.includes(tag)) return "";
    if (tag === "BR") return "\n";
    if (tag === "CODE") return "`" + (node.textContent || "") + "`";
    const inner = Array.from(node.childNodes).map(inline).join("");
    if (tag === "STRONG" || tag === "B") return inner.trim() ? `**${inner}**` : inner;
    if (tag === "EM" || tag === "I") return inner.trim() ? `*${inner}*` : inner;
    const href = tag === "A" ? node.getAttribute("href") : null;
    return href && /^https?:/i.test(href) ? `[${inner}](${href})` : inner;
  };

  // The fence is longer than any backtick run inside, so code cannot close it early.
  const fenced = (lang, body) => {
    const longest = Math.max(0, ...(body.match(/`+/g) || []).map((run) => run.length));
    const fence = "`".repeat(Math.max(3, longest + 1));
    return fence + lang + "\n" + body.replace(/\n$/, "") + "\n" + fence;
  };

  const listItem = (li, marker, indent) => {
    const continuation = indent + " ".repeat(marker.length);
    const item = [];
    let run = "";
    const flush = () => {
      const lines = run.trim().split("\n");
      run = "";
      if (!lines[0]) return;
      item.push((item.length ? continuation : indent + marker) + lines[0]);
      for (const line of lines.slice(1)) item.push(continuation + line.trim());
    };
    for (const child of Array.from(li.childNodes)) {
      const tag = tagOf(child);
      const isList = tag === "UL" || tag === "OL";
      const isBlock = isList || tag && (
      ["CODE-BLOCK", "PRE", "TABLE", "BLOCKQUOTE", "RESPONSE-ELEMENT"].includes(tag) ||
      child.querySelector("pre, code-block, table, blockquote"));
      if (!isBlock) {
        // Only the seam is collapsed, so spaces inside inline code survive.
        let piece = tag === "P" ? (run.trim() ? " " : "") + inline(child).trim() : inline(child);
        if (/\s$/.test(run)) piece = piece.replace(/^\s+/, "");
        run += piece;
        continue;
      }
      flush();
      if (!item.length) item.push(indent + marker);
      if (isList) item.push(...block(child, indent + "  "));else
      for (const part of block(child, "")) {
        item.push(part.split("\n").map((line) => line ? continuation + line : line).join("\n"));
      }
    }
    flush();
    return item.length ? item : [indent + marker];
  };

  const block = (node, indent) => {
    if (node.nodeType === 3) {
      const text = (node.nodeValue || "").trim();
      return text ? [text] : [];
    }
    const tag = tagOf(node);
    if (!tag || SKIP.includes(tag) || node.classList.contains("code-block-decoration")) return [];
    if (tag === "CODE-BLOCK") {
      const code = node.querySelector("pre code") || node.querySelector("pre") || node;
      const label = node.querySelector(".code-block-decoration span")?.textContent || "";
      return [fenced(label.trim().toLowerCase().replace(/[^a-z0-9+#.-]/g, ""), code.textContent || "")];
    }
    if (tag === "PRE") return [fenced("", node.textContent || "")];
    if (tag === "P") {
      const text = inline(node).trim();
      return text ? [text] : [];
    }
    if (/^H[1-6]$/.test(tag)) return ["#".repeat(Number(tag[1])) + " " + inline(node).trim()];
    if (tag === "HR") return ["---"];
    if (tag === "UL" || tag === "OL") {
      let number = Number(node.getAttribute("start") || "1");
      const items = Array.from(node.children).filter((child) => tagOf(child) === "LI");
      return [items.flatMap((li) => listItem(li, tag === "OL" ? `${number++}. ` : "- ", indent)).join("\n")];
    }
    if (tag === "BLOCKQUOTE") {
      const quoted = Array.from(node.childNodes).flatMap((child) => block(child, "")).join("\n\n");
      return [quoted.split("\n").map((line) => "> " + line).join("\n")];
    }
    if (tag === "TABLE") {
      const rows = Array.from(node.querySelectorAll("tr")).map((tr) =>
      Array.from(tr.children).map((cell) => inline(cell).trim().replace(/\|/g, "\\|")));
      if (!rows.length) return [];
      const line = (cells) => "| " + cells.join(" | ") + " |";
      return [[line(rows[0]), "|" + rows[0].map(() => " --- ").join("|") + "|", ...rows.slice(1).map(line)].join("\n")];
    }
    // Containers: recurse, keeping runs of inline content as one paragraph.
    const out = [];
    let run = "";
    const flush = () => {
      if (run.trim()) out.push(run.trim());
      run = "";
    };
    for (const child of Array.from(node.childNodes)) {
      const childTag = tagOf(child);
      if (child.nodeType === 3 || INLINE.includes(childTag) && !child.querySelector(BLOCK_CHILDREN)) {
        run += inline(child);
      } else {
        flush();
        out.push(...block(child, indent));
      }
    }
    flush();
    return out;
  };

  // No newline squashing: it would also rewrite blank lines inside code blocks.
  return {
    queries,
    responses: responses.length,
    busy: panel.getAttribute("aria-busy") === "true",
    text: block(panel, "").join("\n\n").trim()
  };
}

/**
 * Runs in the page: true when Gemini rendered its signed-out UI, which an expired
 * or rotated-away cookie lands on while the composer still works. Not keyed on
 * accounts.google.com links: signed-in pages carry those too.
 */
export function isGeminiSignedOutInPage(doc) {
  return Boolean((doc || document).querySelector('[data-test-id="mode-picker-sign-in-button"]'));
}

/**
 * `page.evaluate` source for a self-contained function. Transpilers that keep
 * names (esbuild/tsx) wrap inner functions in `__name()`, which the page lacks,
 * so a local no-op is declared next to the serialized source.
 */
export function toInPageExpression(fn) {
  return `(() => { const __name = (f) => f; return (${fn.toString()})(); })()`;
}

/** The in-page result, or null when the page cannot run or answer it. */
async function evaluateInPage(page, fn) {
  if (!isFunction(page.evaluate)) return null;
  try {
    return (await page.evaluate(toInPageExpression(fn))) ?? null;
  } catch {
    return null;
  }
}

export const snapshotGeminiDom = (page) => evaluateInPage(page, readGeminiDomReply);

export const isGeminiSignedOut = async (page) => (await evaluateInPage(page, isGeminiSignedOutInPage)) === true;

/**
 * True once a new `user-query` shows the prompt went out, false when none
 * appeared in time, null when the page cannot be read.
 */
async function waitForPromptSubmitted(page, baselineQueries, isDecided) {
  const deadline = Date.now() + SUBMIT_CONFIRM_MS;
  while (Date.now() < deadline) {
    if (isDecided()) return true;
    const snapshot = await snapshotGeminiDom(page);
    if (!snapshot) return null;
    if (snapshot.queries > baselineQueries) return true;
    await page.waitForTimeout(SUBMIT_POLL_MS);
  }
  return false;
}

/**
 * Poll until an answer newer than `baselineResponses` is no longer `aria-busy`
 * and has not changed for REPLY_STABLE_MS. Resolves "" on timeout,
 * cancellation or an unreadable page.
 */
export async function waitForGeminiDomReply(page, { baselineResponses, timeoutMs, isCancelled = () => false }) {
  const deadline = Date.now() + timeoutMs;
  let lastText = "";
  let stableSince = 0;
  while (Date.now() < deadline && !isCancelled()) {
    const snapshot = await snapshotGeminiDom(page);
    if (!snapshot) return "";
    const finished = snapshot.responses > baselineResponses && !snapshot.busy ? snapshot.text : "";
    if (finished !== lastText) {
      lastText = finished;
      stableSince = Date.now();
    } else if (finished && Date.now() - stableSince >= REPLY_STABLE_MS) {
      return finished;
    }
    await page.waitForTimeout(REPLY_POLL_MS);
  }
  return "";
}

/**
 * Wait for the answer to the prompt just submitted, from the network or the page.
 *
 * An Enter pressed while the composer is still settling is dropped silently, so
 * Enter is pressed once more when the page shows no new prompt. It is never
 * repeated once the network has answered or when the page cannot be read.
 *
 * @param {object} page
 * @param {object} options
 * @param {{queries:number,responses:number}|null} options.baseline  DOM counts before
 *   the prompt; null keeps the network-only wait
 * @param {Promise<void>} options.network   settles when StreamGenerate was read
 * @param {() => boolean} options.isDecided true once StreamGenerate produced text
 *   or an error status
 * @param {number} options.timeoutMs
 * @returns {Promise<string>} the answer read from the page, or ""
 */
export async function waitForGeminiAnswer(page, { baseline, network, isDecided, timeoutMs }) {
  if (!baseline) {
    await Promise.race([network, page.waitForTimeout(timeoutMs)]);
    return "";
  }
  if ((await waitForPromptSubmitted(page, baseline.queries, isDecided)) === false && !isDecided()) {
    await page.keyboard.press("Enter");
    await waitForPromptSubmitted(page, baseline.queries, isDecided);
  }
  let domText = "";
  let finished = false;
  const never = new Promise(() => {});
  // Only a usable result may end the wait: an unreadable StreamGenerate body or an
  // empty DOM poll leaves the other source running.
  const fromPage = waitForGeminiDomReply(page, {
    baselineResponses: baseline.responses, timeoutMs, isCancelled: () => finished
  }).then((text) => {
    domText = text;
    return text ? undefined : never;
  });
  const fromNetwork = network.then(() => isDecided() ? undefined : never);
  try {
    await Promise.race([fromNetwork, fromPage, page.waitForTimeout(timeoutMs)]);
  } finally {
    finished = true;
  }
  return domText;
}
