// ─────────────────────────────────────────────────────────────
// `unfragile setup` (20 Nov 2026, finding 6 of the 9 Nov teardown, built to the CTO's rule): add Unfragile's MCP server
// to the coding agents on this machine, one agent at a time, with the user's consent.
//   - Each agent's own command where it has one (Claude Code `claude mcp add`, VS Code `code --add-mcp`).
//   - Otherwise its one config file: ONE key is merged (mcpServers.unfragile, or [mcp_servers.unfragile] in TOML), a
//     backup of the file is written first, and nothing else in the file changes. A file we cannot parse is left alone.
//   - It asks before each agent (y/N; --yes skips the question). --dry-run shows what would change and writes nothing.
//   - It never touches a model, a base URL, a key or any other server's entry. An existing unfragile entry is left
//     as it is.
//   - The hosted server (https://unfragile.ai/api/mcp) by default; --stdio uses the npm package instead. An agent that
//     only runs local servers (Claude Desktop, Codex) always gets the npm package.
// ─────────────────────────────────────────────────────────────
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, copyFileSync } from "node:fs";
import { dirname, join, delimiter } from "node:path";
import { homedir, platform } from "node:os";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";

export const HOSTED_URL = "https://unfragile.ai/api/mcp";
export const NAME = "unfragile";
const STDIO = { command: "npx", args: ["-y", "@unfragile/mcp-server"] };

export interface Env { home: string; path: string; os: NodeJS.Platform; appData?: string; now?: () => Date }
export interface Io { log: (s: string) => void; ask: (q: string) => Promise<boolean> }
export interface Opts { yes: boolean; dryRun: boolean; stdio: boolean; only: string[] | null }

type Result = { agent: string; status: "added" | "would add" | "already set" | "different entry, left as is" | "skipped" | "not found" | "failed"; detail: string };

/** Is a command on PATH? Read from the PATH we were given, never run. */
export function onPath(cmd: string, env: Env): string | null {
  const exts = env.os === "win32" ? [".cmd", ".exe", ""] : [""];
  for (const dir of env.path.split(delimiter).filter(Boolean)) for (const e of exts) { const p = join(dir, cmd + e); if (existsSync(p)) return p; }
  return null;
}

type JsonAgent = { kind: "json"; id: string; name: string; file: (env: Env) => string; present: (env: Env) => boolean; entry: (o: Opts) => Record<string, unknown> };
type CliAgent = { kind: "cli"; id: string; name: string; cmd: string; has: string[]; file?: (env: Env) => string; add: (o: Opts) => string[] };
type TomlAgent = { kind: "toml"; id: string; name: string; file: (env: Env) => string; present: (env: Env) => boolean };
type Agent = JsonAgent | CliAgent | TomlAgent;

const desktopFile = (env: Env) => env.os === "darwin" ? join(env.home, "Library", "Application Support", "Claude", "claude_desktop_config.json")
  : env.os === "win32" ? join(env.appData ?? join(env.home, "AppData", "Roaming"), "Claude", "claude_desktop_config.json")
  : join(env.home, ".config", "Claude", "claude_desktop_config.json");

export const AGENTS: Agent[] = [
  { kind: "cli", id: "claude-code", name: "Claude Code", cmd: "claude", has: ["mcp", "get", NAME],
    add: (o) => o.stdio ? ["mcp", "add", "--scope", "user", NAME, "--", ...[STDIO.command, ...STDIO.args]] : ["mcp", "add", "--scope", "user", "--transport", "http", NAME, HOSTED_URL] },
  // VS Code has no "mcp get"; its user mcp.json (JSONC) is read, never written, to see whether the entry exists
  { kind: "cli", id: "vscode", name: "VS Code", cmd: "code", has: [],
    file: (e) => e.os === "darwin" ? join(e.home, "Library", "Application Support", "Code", "User", "mcp.json") : e.os === "win32" ? join(e.appData ?? join(e.home, "AppData", "Roaming"), "Code", "User", "mcp.json") : join(e.home, ".config", "Code", "User", "mcp.json"),
    add: (o) => ["--add-mcp", JSON.stringify(o.stdio ? { name: NAME, type: "stdio", ...STDIO } : { name: NAME, type: "http", url: HOSTED_URL })] },
  { kind: "json", id: "cursor", name: "Cursor", file: (e) => join(e.home, ".cursor", "mcp.json"), present: (e) => existsSync(join(e.home, ".cursor")),
    entry: (o) => (o.stdio ? { ...STDIO } : { url: HOSTED_URL }) },
  { kind: "json", id: "windsurf", name: "Windsurf", file: (e) => join(e.home, ".codeium", "windsurf", "mcp_config.json"), present: (e) => existsSync(join(e.home, ".codeium", "windsurf")),
    entry: (o) => (o.stdio ? { ...STDIO } : { serverUrl: HOSTED_URL }) },
  { kind: "json", id: "gemini", name: "Gemini CLI", file: (e) => join(e.home, ".gemini", "settings.json"), present: (e) => existsSync(join(e.home, ".gemini")),
    entry: (o) => (o.stdio ? { ...STDIO } : { httpUrl: HOSTED_URL }) },
  { kind: "json", id: "claude-desktop", name: "Claude Desktop", file: desktopFile, present: (e) => existsSync(dirname(desktopFile(e))),
    entry: () => ({ ...STDIO }) },   // Desktop's file runs local servers only; remote ones are added as connectors in the app
  { kind: "toml", id: "codex", name: "Codex", file: (e) => join(e.home, ".codex", "config.toml"), present: (e) => existsSync(join(e.home, ".codex")) },
];

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const stamp = (env: Env) => (env.now ? env.now() : new Date()).toISOString().replace(/[:.]/g, "-");

/** Write beside the file and rename over it, so a crash never leaves half a file. */
function writeAtomic(file: string, text: string): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.unfragile-tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
}

function jsonAgent(a: JsonAgent, o: Opts, env: Env): Result {
  const file = a.file(env), entry = a.entry(o);
  let doc: Record<string, unknown> = {}, raw: string | null = null;
  if (existsSync(file)) {
    raw = readFileSync(file, "utf8");
    if (raw.trim()) {
      try { const p = JSON.parse(raw); if (typeof p !== "object" || p === null || Array.isArray(p)) throw new Error("not an object"); doc = p; }
      catch (e) { return { agent: a.name, status: "failed", detail: `${file} is not plain JSON (${(e as Error).message}); left untouched. Add this by hand under "mcpServers": "${NAME}": ${JSON.stringify(entry)}` }; }
    }
  }
  const servers = doc.mcpServers;
  if (servers !== undefined && (typeof servers !== "object" || servers === null || Array.isArray(servers))) return { agent: a.name, status: "failed", detail: `${file}: "mcpServers" is not an object; left untouched` };
  const current = (servers as Record<string, unknown> | undefined)?.[NAME];
  if (current !== undefined) return same(current, entry) ? { agent: a.name, status: "already set", detail: file } : { agent: a.name, status: "different entry, left as is", detail: `${file} already has "${NAME}": ${JSON.stringify(current)}` };
  const next = { ...doc, mcpServers: { ...(servers as Record<string, unknown> | undefined), [NAME]: entry } };
  const diff = `${file}\n  + "mcpServers"."${NAME}": ${JSON.stringify(entry)}`;
  if (o.dryRun) return { agent: a.name, status: "would add", detail: diff };
  let backup = "";
  if (raw !== null) { backup = `${file}.unfragile-backup-${stamp(env)}`; copyFileSync(file, backup); }
  writeAtomic(file, JSON.stringify(next, null, 2) + "\n");
  return { agent: a.name, status: "added", detail: `${diff}${backup ? `\n  backup: ${backup}` : ""}` };
}

function tomlAgent(a: TomlAgent, o: Opts, env: Env): Result {
  const file = a.file(env), raw = existsSync(file) ? readFileSync(file, "utf8") : "";
  if (/^\s*\[mcp_servers\.unfragile\]\s*$/m.test(raw)) return { agent: a.name, status: "already set", detail: `${file} already has [mcp_servers.${NAME}]; left as is` };
  // appended, never rewritten: Codex runs local servers, so it gets the npm package
  const block = `\n[mcp_servers.${NAME}]\ncommand = "${STDIO.command}"\nargs = [${STDIO.args.map((x) => `"${x}"`).join(", ")}]\n`;
  const diff = `${file}\n${block.trim().split("\n").map((l) => `  + ${l}`).join("\n")}`;
  if (o.dryRun) return { agent: a.name, status: "would add", detail: diff };
  let backup = "";
  if (existsSync(file)) { backup = `${file}.unfragile-backup-${stamp(env)}`; copyFileSync(file, backup); }
  writeAtomic(file, (raw && !raw.endsWith("\n") ? raw + "\n" : raw) + block);
  return { agent: a.name, status: "added", detail: `${diff}${backup ? `\n  backup: ${backup}` : ""}` };
}

function cliAgent(a: CliAgent, o: Opts, env: Env, bin: string): Result {
  const cfg = a.file?.(env);
  if (cfg && existsSync(cfg) && new RegExp(`"${NAME}"\\s*:`).test(readFileSync(cfg, "utf8"))) return { agent: a.name, status: "already set", detail: `${cfg} already names ${NAME}; left as is` };
  if (a.has.length) {
    const got = spawnSync(bin, a.has, { encoding: "utf8", env: { ...process.env, PATH: env.path }, timeout: 20_000 });
    if (got.status === 0) return { agent: a.name, status: "already set", detail: `${a.cmd} ${a.has.join(" ")} found an entry named ${NAME}; left as is` };
  }
  const args = a.add(o), shown = `${a.cmd} ${args.map((x) => (/[\s"{}]/.test(x) ? `'${x}'` : x)).join(" ")}`;
  if (o.dryRun) return { agent: a.name, status: "would add", detail: `runs: ${shown}` };
  const r = spawnSync(bin, args, { encoding: "utf8", env: { ...process.env, PATH: env.path }, timeout: 60_000 });
  return r.status === 0 ? { agent: a.name, status: "added", detail: `ran: ${shown}` } : { agent: a.name, status: "failed", detail: `${shown} exited ${r.status}: ${(r.stderr || r.stdout || "").trim().slice(0, 300)}` };
}

export async function runSetup(o: Opts, env: Env, io: Io): Promise<Result[]> {
  const out: Result[] = [];
  io.log(`unfragile setup: adds Unfragile's MCP server (${o.stdio ? "the npm package, run locally" : HOSTED_URL}) to the coding agents found on this machine.`);
  io.log("It changes one entry per agent, keeps a backup of any file it edits, and never touches a model, a base URL or another server.");
  if (o.dryRun) io.log("Dry run: nothing will be written.");
  for (const a of AGENTS) {
    if (o.only && !o.only.includes(a.id)) continue;
    const bin = a.kind === "cli" ? onPath(a.cmd, env) : null;
    const present = a.kind === "cli" ? Boolean(bin) : a.present(env);
    if (!present) { out.push({ agent: a.name, status: "not found", detail: a.kind === "cli" ? `\`${a.cmd}\` is not on PATH` : `no ${dirname(a.file(env))}` }); continue; }
    if (!o.dryRun && !o.yes && !(await io.ask(`Add Unfragile to ${a.name}? [y/N] `))) { out.push({ agent: a.name, status: "skipped", detail: "you said no" }); continue; }
    try {
      out.push(a.kind === "cli" ? cliAgent(a, o, env, bin!) : a.kind === "json" ? jsonAgent(a, o, env) : tomlAgent(a, o, env));
    } catch (e) { out.push({ agent: a.name, status: "failed", detail: (e as Error).message.slice(0, 300) }); }
  }
  for (const r of out) io.log(`  ${r.agent.padEnd(15)} ${r.status}${r.detail ? `\n    ${r.detail.replace(/\n/g, "\n    ")}` : ""}`);
  if (out.some((r) => r.status === "added")) io.log("Restart the agents you changed. To undo, restore the backup file, or run the agent's own `mcp remove unfragile`.");
  return out;
}

export function setupOpts(argv: string[]): Opts {
  const only = argv.find((a) => a.startsWith("--only="))?.slice(7).split(",").map((s) => s.trim()).filter(Boolean) ?? null;
  return { yes: argv.includes("--yes") || argv.includes("-y"), dryRun: argv.includes("--dry-run"), stdio: argv.includes("--stdio"), only };
}

export function defaultEnv(): Env {
  return { home: process.env.UNFRAGILE_SETUP_HOME || homedir(), path: process.env.PATH ?? "", os: platform(), appData: process.env.APPDATA };
}

export function terminalIo(): Io {
  return {
    log: (s) => console.log(s),
    ask: async (q) => {
      if (!process.stdin.isTTY) return false;   // no terminal to answer: nothing is changed without a yes
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try { return /^y(es)?$/i.test((await rl.question(q)).trim()); } finally { rl.close(); }
    },
  };
}
