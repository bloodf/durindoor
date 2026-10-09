import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Run only against a disposable server and a recording fixture provider. The
// verifier supplies generated identities/resources; never production credentials.
// No routing is implemented here: every encoded/alias request traverses Next.
const manifest = JSON.parse(await readFile(process.argv[2], "utf8"));
assert.equal(manifest.disposable, true, "Explicit disposable fixture attestation required");
const origin = new URL(manifest.origin);
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname), "Only loopback fixture servers allowed");
assert.ok(manifest.journal, "Recording fixture-provider journal required");
const principals = ["dashboard", "cli", "owner", "foreign", "inactive", "expired", "anonymous"];
for (const principal of principals) assert.ok(manifest.principals[principal], `Missing fixture principal ${principal}`);
for (const family of ["file", "batch", "media", "direct", "reroute", "combo"]) {
  assert.ok(manifest.cases.some((row) => row.family === family), `Missing ${family} acceptance cases`);
}
for (const scope of ["allowed", "model-denied", "account-denied", "combo-denied", "unknown-owner"]) {
  assert.ok(manifest.cases.some((row) => row.scope === scope), `Missing ${scope} acceptance cases`);
}
const spellings = {
  canonical: (path) => `/api${path}`,
  alias: (path) => path,
  "double-v1": (path) => `/v1${path}`,
  encoded: (path) => path.replace(/[a-z0-9]/gi, (char) => `%${char.charCodeAt(0).toString(16)}`),
};
async function journal() {
  const text = await readFile(manifest.journal, "utf8");
  return text.trim() ? text.trim().split("\n").map((line) => JSON.parse(line)) : [];
}
let rows = 0;
for (const scenario of manifest.cases) {
  assert.match(scenario.path, /^\/v1\//);
  // Cases must be repeatable: seeded reads or stateless chat. Creation/deletion
  // ownership transitions are exercised in the integrated unit matrix.
  assert.ok(["GET", "POST"].includes(scenario.method));
  const variants = { ...spellings };
  if (scenario.path === "/v1/responses") {
    variants.responses = () => "/responses";
    variants.codex = () => "/codex/responses";
  }
  for (const [variant, encode] of Object.entries(variants)) {
    for (const principal of principals) {
      const expected = scenario.expected[principal];
      assert.ok(expected, `${scenario.name}: missing ${principal} expectation`);
      assert.ok(Number.isInteger(expected.status));
      assert.ok(Array.isArray(expected.dispatches), "Exact upstream dispatch expectations required");
      const label = `${scenario.name} / ${variant} / ${principal}`;
      const before = await journal();
      const url = new URL(`${encode(scenario.path)}${scenario.query || ""}`, origin);
      const response = await fetch(url, {
        method: scenario.method, redirect: "manual",
        headers: { "content-type": "application/json", ...scenario.headers, ...manifest.principals[principal] },
        ...(scenario.body === undefined ? {} : { body: JSON.stringify(scenario.body) }),
      });
      const body = await response.text();
      assert.equal(response.status, expected.status, label);
      assert.equal(response.headers.get("location"), null, `${label}: unexpected redirect`);
      if (expected.json !== undefined) assert.deepEqual(JSON.parse(body), expected.json, label);
      if (expected.ids !== undefined) assert.deepEqual(JSON.parse(body).data.map((row) => row.id), expected.ids, label);
      for (const forbidden of expected.absent || []) assert.ok(!body.includes(forbidden), `${label}: leaked forbidden value`);
      // The recorder appends before answering upstream, so a consumed response
      // has a stable journal boundary. Never accept only a status-code proof.
      const after = await journal();
      assert.deepEqual(after.slice(0, before.length), before, `${label}: journal changed history`);
      assert.deepEqual(after.slice(before.length).map(({ provider, account, model, path }) => ({ provider, account, model, path })), expected.dispatches, `${label}: wrong upstream dispatch`);
      console.log(`PASS ${label}`);
      rows++;
    }
  }
}
console.log(`HTTP acceptance: ${rows} rows; actual Next rewrites, principals and fixture-provider dispatches`);
