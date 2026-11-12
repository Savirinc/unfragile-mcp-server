// Guard fail-closed laws. Runs the built CLI (dist/guard.js) against a local stub verify server.
// Nothing leaves localhost; the wrapped command is a harmless `node -e` that writes a marker file.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const GUARD = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "guard.js");
let server, base, dir;
const seen = [];

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "guard-test-"));
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const { target } = JSON.parse(body || "{}");
      seen.push(target);
      const json = (o) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(o));
      switch (String(target).replace(/^npm:/, "")) {
        case "safe-pkg": return json({ verdict: "trusted" });
        case "bad-pkg": return json({ verdict: "flagged", summary: "known malicious" });
        case "err-pkg": return res.writeHead(500).end("boom");
        case "garbage-pkg": return res.writeHead(200, { "content-type": "application/json" }).end("<html>not json");
        case "noverdict-pkg": return json({ ok: true });
        case "slow-pkg": return; // never answers: the guard's own timeout must block
        default: return res.writeHead(404).end();
      }
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.closeAllConnections?.();
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

let n = 0;
/** Run `unfragile guard [flags] -- node -e <write marker> [extra...]`; report exit code and whether the command ran.
 *  Async spawn so the in-process stub server keeps answering while the guard runs. */
function guard({ flags = [], extra = [], api = base, env = {} } = {}) {
  const marker = join(dir, `ran-${n++}`);
  const script = `require("fs").writeFileSync(${JSON.stringify(marker)}, "x")`;
  const child = spawn(process.execPath, [GUARD, "guard", ...flags, "--", process.execPath, "-e", script, ...extra], {
    env: { ...process.env, UNFRAGILE_API_URL: api, ...env },
  });
  let err = "";
  child.stderr.on("data", (c) => (err += c));
  return new Promise((resolve) => child.on("close", (code) => resolve({ code, ran: existsSync(marker), err })));
}
const pkg = (name) => ["npx", "-y", name];

test("trusted verdict: command runs", async () => {
  const r = await guard({ extra: pkg("safe-pkg") });
  assert.equal(r.ran, true, r.err);
  assert.equal(r.code, 0);
});

test("flagged verdict: blocked, exit 1", async () => {
  const r = await guard({ extra: pkg("bad-pkg") });
  assert.equal(r.ran, false);
  assert.equal(r.code, 1);
  assert.match(r.err, /BLOCKED/);
});

test("flagged verdict: --allow-unverified does NOT override a flag", async () => {
  const r = await guard({ flags: ["--allow-unverified"], extra: pkg("bad-pkg") });
  assert.equal(r.ran, false);
  assert.equal(r.code, 1);
});

test("flagged verdict: --force still overrides (existing behaviour)", async () => {
  const r = await guard({ flags: ["--force"], extra: pkg("bad-pkg") });
  assert.equal(r.ran, true, r.err);
});

for (const [name, opts] of [
  ["HTTP 500", { extra: pkg("err-pkg") }],
  ["non-JSON reply", { extra: pkg("garbage-pkg") }],
  ["JSON without a verdict", { extra: pkg("noverdict-pkg") }],
  ["timeout", { extra: pkg("slow-pkg"), env: { UNFRAGILE_VERIFY_TIMEOUT_MS: "500" } }],
  ["connection refused", { extra: pkg("safe-pkg"), api: "http://127.0.0.1:1" }],
  ["no install target", { extra: [] }],
]) {
  test(`${name}: blocked by default, exit 3`, async () => {
    const r = await guard(opts);
    assert.equal(r.ran, false, r.err);
    assert.equal(r.code, 3);
    assert.match(r.err, /BLOCKED/);
    assert.match(r.err, /--allow-unverified/);
  });
  test(`${name}: runs with --allow-unverified, with a loud warning`, async () => {
    const r = await guard({ ...opts, flags: ["--allow-unverified"] });
    assert.equal(r.ran, true, r.err);
    assert.equal(r.code, 0);
    assert.match(r.err, /WARNING/);
    assert.match(r.err, /UNVERIFIED/);
  });
}

test("guard flags after `--` belong to the wrapped command, not the guard", async () => {
  const r = await guard({ extra: [...pkg("err-pkg"), "--allow-unverified"] });
  assert.equal(r.ran, false);
  assert.equal(r.code, 3);
});

test("package argument is read like the server parser: flag values are not the package", async () => {
  seen.length = 0;
  await guard({ extra: ["npx", "--registry", "https://example.invalid", "-y", "safe-pkg@1.2.3", "--port", "9"] });
  assert.deepEqual(seen, ["npm:safe-pkg"]);
});
