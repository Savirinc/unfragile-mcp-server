// `unfragile setup` laws (20 Nov 2026). Runs the built module against a throwaway home directory and stub `claude` and
// `code` commands that only record their arguments. Nothing touches the real machine's agents.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const { runSetup, setupOpts, HOSTED_URL } = await import(join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "setup.js"));
let home, bin, env, log;
const io = (answer = true) => ({ log: (s) => log.push(s), ask: async () => answer });
const opts = (a = []) => setupOpts(a);
const stub = (name, getExit) => {
  const f = join(bin, name);
  writeFileSync(f, `#!/bin/sh\necho "$@" >> "${join(bin, name + ".calls")}"\nif [ "$1 $2" = "mcp get" ]; then exit ${getExit}; fi\nexit 0\n`);
  chmodSync(f, 0o755);
};
const calls = (name) => (existsSync(join(bin, name + ".calls")) ? readFileSync(join(bin, name + ".calls"), "utf8").trim().split("\n") : []);
const json = (p) => JSON.parse(readFileSync(p, "utf8"));
const backups = (dir) => readdirSync(dir).filter((f) => f.includes(".unfragile-backup-"));

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "setup-home-")); bin = mkdtempSync(join(tmpdir(), "setup-bin-")); log = [];
  env = { home, path: bin, os: "linux", now: () => new Date("2026-11-20T10:00:00Z") };
  for (const d of [".cursor", ".codeium/windsurf", ".gemini", ".config/Claude", ".codex"]) mkdirSync(join(home, d), { recursive: true });
  stub("claude", 1); stub("code", 1);
});

test("--dry-run writes nothing and runs no add command", async () => {
  const r = await runSetup(opts(["--dry-run"]), env, io());
  assert.ok(r.every((x) => x.status === "would add"), JSON.stringify(r));
  assert.equal(existsSync(join(home, ".cursor", "mcp.json")), false);
  assert.ok(!calls("claude").some((c) => c.startsWith("mcp add")));
  assert.equal(calls("code").length, 0);
});

test("--yes adds one entry per agent, in each agent's own form; the hosted server by default", async () => {
  const r = await runSetup(opts(["--yes"]), env, io());
  assert.ok(r.every((x) => x.status === "added"), JSON.stringify(r));
  assert.deepEqual(json(join(home, ".cursor", "mcp.json")), { mcpServers: { unfragile: { url: HOSTED_URL } } });
  assert.deepEqual(json(join(home, ".codeium", "windsurf", "mcp_config.json")).mcpServers.unfragile, { serverUrl: HOSTED_URL });
  assert.deepEqual(json(join(home, ".gemini", "settings.json")).mcpServers.unfragile, { httpUrl: HOSTED_URL });
  assert.deepEqual(json(join(home, ".config", "Claude", "claude_desktop_config.json")).mcpServers.unfragile, { command: "npx", args: ["-y", "@unfragile/mcp-server"] });
  assert.match(readFileSync(join(home, ".codex", "config.toml"), "utf8"), /\[mcp_servers\.unfragile\]\ncommand = "npx"\nargs = \["-y", "@unfragile\/mcp-server"\]/);
  assert.ok(calls("claude").includes(`mcp add --scope user --transport http unfragile ${HOSTED_URL}`), calls("claude").join("|"));
  assert.ok(calls("code")[0].startsWith("--add-mcp"));
  assert.match(calls("code")[0], /"type":"http","url":"https:\/\/unfragile.ai\/api\/mcp"/);
});

test("an existing file keeps every other key, gets a backup first, and is never touched for a model or base URL", async () => {
  const f = join(home, ".gemini", "settings.json");
  const before = { model: { name: "gemini-pro" }, baseUrl: "https://example.test", mcpServers: { other: { httpUrl: "https://o.test" } }, theme: "dark" };
  writeFileSync(f, JSON.stringify(before, null, 2));
  await runSetup(opts(["--yes", "--only=gemini"]), env, io());
  const after = json(f);
  assert.deepEqual({ ...after, mcpServers: { other: after.mcpServers.other } }, before);
  assert.deepEqual(after.mcpServers.unfragile, { httpUrl: HOSTED_URL });
  const b = backups(dirname(f));
  assert.equal(b.length, 1);
  assert.deepEqual(JSON.parse(readFileSync(join(dirname(f), b[0]), "utf8")), before);
});

test("a second run changes nothing: already set, no new backup, no second add", async () => {
  await runSetup(opts(["--yes"]), env, io());
  stub("claude", 0);   // `claude mcp get unfragile` now finds it
  mkdirSync(join(home, ".config", "Code", "User"), { recursive: true });
  writeFileSync(join(home, ".config", "Code", "User", "mcp.json"), '{ // VS Code keeps comments\n "servers": { "unfragile": { "type": "http" } } }');   // what code --add-mcp wrote
  const codeCalls = calls("code").length;
  const r = await runSetup(opts(["--yes"]), env, io());
  for (const x of r) assert.equal(x.status, "already set", JSON.stringify(x));
  assert.equal(calls("code").length, codeCalls);
  assert.equal(backups(join(home, ".cursor")).length, 0);   // the first run created the file, so there was nothing to back up; the second wrote nothing
});

test("an entry named unfragile that differs is left as it is", async () => {
  const f = join(home, ".cursor", "mcp.json");
  writeFileSync(f, JSON.stringify({ mcpServers: { unfragile: { url: "https://mine.test" } } }));
  const r = await runSetup(opts(["--yes", "--only=cursor"]), env, io());
  assert.equal(r[0].status, "different entry, left as is");
  assert.deepEqual(json(f).mcpServers.unfragile, { url: "https://mine.test" });
});

test("a file that is not plain JSON is left untouched, and says what to add by hand", async () => {
  const f = join(home, ".codeium", "windsurf", "mcp_config.json");
  writeFileSync(f, "{ // a comment\n }");
  const r = await runSetup(opts(["--yes", "--only=windsurf"]), env, io());
  assert.equal(r[0].status, "failed");
  assert.match(r[0].detail, /left untouched/);
  assert.equal(readFileSync(f, "utf8"), "{ // a comment\n }");
});

test("without a yes, nothing changes; an agent that is not here is reported, not created", async () => {
  const r = await runSetup(opts([]), { ...env, home: mkdtempSync(join(tmpdir(), "empty-")) }, io(false));
  assert.deepEqual(r.map((x) => x.status), ["skipped", "skipped", "not found", "not found", "not found", "not found", "not found"]);
  assert.ok(!calls("claude").some((c) => c.startsWith("mcp add")));
});

test("--stdio adds the npm package instead of the hosted server", async () => {
  await runSetup(opts(["--yes", "--stdio", "--only=cursor,claude-code"]), env, io());
  assert.deepEqual(json(join(home, ".cursor", "mcp.json")).mcpServers.unfragile, { command: "npx", args: ["-y", "@unfragile/mcp-server"] });
  assert.ok(calls("claude").includes("mcp add --scope user unfragile -- npx -y @unfragile/mcp-server"));
});
