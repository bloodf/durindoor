const { isString, isObject } = require("../../shared/utils/typeChecks.cjs");
// Inline stdio<->SSE bridge for MCP. Spawns one child per plugin on demand,
// routes JSON-RPC responses to the session that sent the request (id remapping),
// and broadcasts notifications (no id) to every session of that plugin.

const { spawn } = require("child_process");
const crypto = require("crypto");
const { LOCAL_STDIO_PLUGINS } = require("../../shared/constants/coworkPlugins");

// Child processes receive only basic execution, locale and proxy settings.
function childEnv() {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    /^(PATH|HOME|USER|LANG|LC_.*|TMPDIR|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY|SystemRoot|ComSpec)$/i.test(key)
  ));
}

const G_KEY = "__9routerMcpBridges";
const MAX_TEXT_CHARS = 50000;
const COLLAPSE_THRESHOLD = 30;
const COLLAPSE_KEEP_HEAD = 10;
const COLLAPSE_KEEP_TAIL = 5;

// Drop noise nodes, collapse repeated siblings, hard-truncate. Preserve [ref=eXX].
function smartFilterText(text) {
  if (!isString(text) || text.length < 2000) return text;
  let out = text;
  out = out.replace(/^\s*-\s*generic:?\s*$/gm, "");
  out = out.replace(/^\s*-\s*text:\s*""\s*$/gm, "");
  out = collapseRepeated(out);
  if (out.length > MAX_TEXT_CHARS) {
    const head = out.slice(0, MAX_TEXT_CHARS - 300);
    out = `${head}\n\n... [truncated ${text.length - head.length} chars by 9router bridge. Page is large; ask user to scroll/navigate to a specific section, or click an element with the refs shown above]`;
  }
  return out;
}

// Group consecutive lines sharing the same leading indent + role prefix; collapse if >= COLLAPSE_THRESHOLD.
function collapseRepeated(text) {
  const lines = text.split("\n");
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const m = line.match(/^(\s*)-\s*([a-zA-Z]+)\b/);
    if (!m) {out.push(line);i++;continue;}
    const indent = m[1];
    const role = m[2];
    let j = i;
    while (j < lines.length) {
      const ln = lines[j];
      const mm = ln.match(/^(\s*)-\s*([a-zA-Z]+)\b/);
      if (mm && mm[1] === indent && mm[2] === role) {j++;continue;}
      if (ln.startsWith(`${indent} `) || ln.startsWith(`${indent}\t`)) {j++;continue;}
      break;
    }
    const groupLen = j - i;
    if (groupLen >= COLLAPSE_THRESHOLD) {
      const headEnd = findNthSiblingEnd(lines, i, indent, role, COLLAPSE_KEEP_HEAD);
      const tailStart = findLastNSiblingStart(lines, j, indent, role, COLLAPSE_KEEP_TAIL);
      for (let k = i; k < headEnd; k++) out.push(lines[k]);
      out.push(`${indent}... [${groupLen - COLLAPSE_KEEP_HEAD - COLLAPSE_KEEP_TAIL} similar "${role}" items omitted by 9router bridge]`);
      for (let k = tailStart; k < j; k++) out.push(lines[k]);
    } else {
      for (let k = i; k < j; k++) out.push(lines[k]);
    }
    i = j;
  }
  return out.join("\n");
}

function findNthSiblingEnd(lines, start, indent, role, n) {
  let count = 0;
  for (let k = start; k < lines.length; k++) {
    const mm = lines[k].match(/^(\s*)-\s*([a-zA-Z]+)\b/);
    if (mm && mm[1] === indent && mm[2] === role) {
      count++;
      if (count > n) return k;
    }
  }
  return lines.length;
}

function findLastNSiblingStart(lines, end, indent, role, n) {
  const positions = [];
  for (let k = 0; k < end; k++) {
    const mm = lines[k].match(/^(\s*)-\s*([a-zA-Z]+)\b/);
    if (mm && mm[1] === indent && mm[2] === role) positions.push(k);
  }
  return positions.length > n ? positions[positions.length - n] : end;
}

// Apply filter to JSON-RPC tool/result content text blocks only.
function filterFrame(line) {
  try {
    const msg = JSON.parse(line);
    const content = msg?.result?.content;
    if (!Array.isArray(content)) return line;
    let mutated = false;
    for (const item of content) {
      if (item?.type === "text" && isString(item.text)) {
        const filtered = smartFilterText(item.text);
        if (filtered !== item.text) {item.text = filtered;mutated = true;}
      }
    }
    return mutated ? JSON.stringify(msg) : line;
  } catch {return line;}
}
const getStore = () => {
  if (!globalThis[G_KEY]) globalThis[G_KEY] = new Map();
  return globalThis[G_KEY];
};

// Only preset stdio plugins may spawn. No user-defined commands (RCE prevention).
function findPlugin(name) {
  return LOCAL_STDIO_PLUGINS.find((p) => p.name === name) || null;
}

function getOrSpawn(name) {
  const store = getStore();
  let entry = store.get(name);
  if (entry?.proc && !entry.proc.killed && entry.proc.exitCode === null) return entry;

  const plugin = findPlugin(name);
  if (!plugin) throw new Error(`Unknown local plugin: ${name}`);

  const proc = spawn(plugin.command, plugin.args, { stdio: ["pipe", "pipe", "pipe"], env: childEnv() });
  entry = { proc, sessions: new Map(), buffer: "", nextId: 1, pending: new Map() };
  store.set(name, entry);

  // Parse newline-delimited JSON-RPC from child stdout. Responses with a remapped
  // id go only to the session that sent the request; notifications (no id) go to
  // every session of this plugin.
  proc.stdout.on("data", (chunk) => {
    entry.buffer += chunk.toString("utf8");
    let idx;
    while ((idx = entry.buffer.indexOf("\n")) >= 0) {
      const raw = entry.buffer.slice(0, idx).trim();
      entry.buffer = entry.buffer.slice(idx + 1);
      if (!raw) continue;
      const line = filterFrame(raw);
      let msg;
      try { msg = JSON.parse(line); } catch {
        continue;
      }
      if (isObject(msg) && msg.id !== undefined && entry.pending.has(msg.id)) {
        const { sessionId, clientId } = entry.pending.get(msg.id);
        entry.pending.delete(msg.id);
        msg.id = clientId;
        const send = entry.sessions.get(sessionId);
        if (send) {
          try { send(`event: message\ndata: ${JSON.stringify(msg)}\n\n`); } catch { /* ignore broken pipe */ }
        }
        continue;
      }
      if (isObject(msg) && msg.id === undefined) {
        for (const send of entry.sessions.values()) {
          try { send(`event: message\ndata: ${line}\n\n`); } catch { /* ignore broken pipe */ }
        }
      }
    }
  });

  proc.stderr.on("data", (d) => console.log(`[mcp:${name}]`, d.toString().trim()));
  proc.on("exit", (code) => {
    console.log(`[mcp:${name}] exited`, code);
    // Only clear the store if this is still the live child. A late exit from a
    // killed child must not delete a freshly-spawned replacement entry.
    if (store.get(name)?.proc === proc) store.delete(name);
  });

  return entry;
}

function registerSession(name, sendFn) {
  const entry = getOrSpawn(name);
  const sid = crypto.randomUUID();
  entry.sessions.set(sid, sendFn);
  return sid;
}

function unregisterSession(name, sid) {
  const entry = getStore().get(name);
  if (!entry) return;
  entry.sessions.delete(sid);
  // No sessions left → kill child to avoid idle orphan process leak.
  if (entry.sessions.size === 0) {
    try {entry.proc.kill();} catch {/* ignore */}
    getStore().delete(name);
  }
}

/**
 * Kill every spawned MCP child and clear the bridge store.
 * Called on app shutdown (SIGINT/SIGTERM) so child processes do not outlive
 * the parent as orphans. Best-effort: individual kill failures are ignored.
 */
function killAllBridges() {
  const store = getStore();
  for (const [name, entry] of store) {
    try {entry.proc.kill();} catch {/* ignore */}
    store.delete(name);
  }
}

/**
 * Write a JSON-RPC frame to the plugin child.
 * When `sessionId` is provided and the frame has an `id`, remap to a bridge-local
 * id so the matching response is delivered only to that session.
 */
function sendToChild(name, jsonRpc, sessionId) {
  const entry = getStore().get(name);
  if (!entry?.proc?.stdin?.writable) throw new Error(`Bridge not running: ${name}`);
  let frame = jsonRpc;
  if (sessionId && isObject(jsonRpc) && jsonRpc.id !== undefined) {
    if (!entry.pending) entry.pending = new Map();
    if (!entry.nextId) entry.nextId = 1;
    const clientId = jsonRpc.id;
    const internalId = entry.nextId++;
    entry.pending.set(internalId, { sessionId, clientId });
    frame = { ...jsonRpc, id: internalId };
  }
  entry.proc.stdin.write(`${JSON.stringify(frame)}\n`);
}

function isRunning(name) {
  const entry = getStore().get(name);
  return !!(entry?.proc && !entry.proc.killed && entry.proc.exitCode === null);
}

module.exports = { getOrSpawn, registerSession, unregisterSession, sendToChild, isRunning, findPlugin, killAllBridges };