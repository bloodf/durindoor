import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ hooks: [], index: 0, effects: [], enabled: false, calls: [] }));

vi.mock("react", async () => {
  const actual = await vi.importActual("react");
  return {
    ...actual,
    useState(initial) {
      const index = state.index++;
      if (!(index in state.hooks)) state.hooks[index] = initial;
      return [state.hooks[index], (next) => {
        state.hooks[index] = typeof next === "function" ? next(state.hooks[index]) : next;
      }];
    },
    useRef(value) {
      const index = state.index++;
      if (!(index in state.hooks)) state.hooks[index] = { current: value };
      return state.hooks[index];
    },
    useEffect(effect) { state.effects.push(effect); },
    useCallback(callback) { return callback; },
  };
});
vi.mock("@/shared/components", () => ({
  Card: function Card() {}, Button: function Button() {}, Input: function Input() {}, Modal: function Modal() {}, Toggle: function Toggle() {},
}));
vi.mock("@/shared/hooks/useCopyToClipboard", () => ({ useCopyToClipboard: () => ({ copied: false, copy: vi.fn() }) }));
vi.mock("@/i18n/runtime", () => ({ getCurrentLocale: () => "en", onLocaleChange: () => () => {} }));
vi.mock("../../src/app/(dashboard)/dashboard/token-saver/components/TokenSaverOverview.js", () => ({ default: function TokenSaverOverview() {} }));
vi.mock("../../src/app/(dashboard)/dashboard/pxpipe/PxpipeClient.js", () => ({ default: function PxpipeClient() {} }));
vi.mock("../../src/app/(dashboard)/dashboard/pxpipe/pxpipeStatus.js", () => ({
  fetchPxpipeStatus: async () => ({ installed: false, running: false }), getPxpipeStatusView: () => ({ label: "Unavailable" }),
}));

const { default: TokenSaverClient } = await import("@/app/(dashboard)/dashboard/token-saver/TokenSaverClient.jsx");
const { Toggle } = await import("@/shared/components");

function response(body) { return { ok: true, json: async () => body }; }
function walk(element, predicate, result = []) {
  if (element == null || typeof element !== "object") return result;
  if (predicate(element)) result.push(element);
  const children = element.props?.children;
  for (const child of Array.isArray(children) ? children : [children]) walk(child, predicate, result);
  return result;
}
async function drainEffects() {
  while (state.effects.length) {
    const effects = state.effects.splice(0);
    for (const effect of effects) effect();
    for (let i = 0; i < 4; i += 1) await Promise.resolve();
  }
}
async function renderWithProxyDown(enabled) {
  state.enabled = enabled;
  state.index = 0;
  state.hooks = [];
  state.effects = [];
  TokenSaverClient({ view: "settings" });
  await drainEffects();
  state.index = 0;
  return TokenSaverClient({ view: "settings" });
}
function headroomToggle(tree) {
  return walk(tree, (node) => node.type === Toggle && node.props.ariaLabel === "Enable Headroom")[0];
}

describe("Token Saver Headroom enabled setting", () => {
  beforeEach(() => {
    state.calls = [];
    vi.stubGlobal("fetch", vi.fn(async (url, options = {}) => {
      state.calls.push({ url, options });
      if (url === "/api/settings" && options.method === "PATCH") return response({ success: true });
      if (url === "/api/settings") return response({ headroomEnabled: state.enabled });
      if (url === "/api/headroom/status") return response({ installed: true, running: false, localUrl: true });
      if (url === "/api/headroom/extras") return response({ version: null, extras: {}, available: [] });
      throw new Error(`Unexpected fetch: ${url}`);
    }));
  });

  it.each([[true, false], [false, true]])("uses persisted %s intent and PATCHes %s while proxy is stopped", async (enabled, next) => {
    const tree = await renderWithProxyDown(enabled);
    const toggle = headroomToggle(tree);
    expect(toggle.props.checked).toBe(enabled);
    expect(toggle.props.disabled).not.toBe(true);
    expect(walk(tree, (node) => typeof node.type === "string" && node.type === "span" && node.props.children === "Stopped").length).toBeGreaterThanOrEqual(1);
    toggle.props.onChange();
    expect(state.calls.at(-1)).toMatchObject({
      url: "/api/settings",
      options: { method: "PATCH", body: JSON.stringify({ headroomEnabled: next, headroomUrl: "http://localhost:8787" }) },
    });
  });
});
