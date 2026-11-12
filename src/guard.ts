#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
// `unfragile` — verify-before-invoke CLI guard.
//
// The viral dev hook: verify an MCP server / package BEFORE you install it.
//
//   npx -y @unfragile/mcp-server verify mcp:@scope/server
//   npx -y @unfragile/mcp-server guard -- claude mcp add pg -- npx -y @scope/pg-mcp
//
// `verify <target>`  → prints the signed verdict; exit 1 if flagged.
// `guard -- <cmd…>`  → extracts the install target from a `claude mcp add`
//                      (or any `npx …`) command, verifies it, BLOCKS on
//                      `flagged` (unless --force), then runs the real command.
//                      FAILS CLOSED: if no target can be read, or verification
//                      is unavailable or malformed, the command does NOT run
//                      unless --allow-unverified is given (loud warning).
// ─────────────────────────────────────────────────────────────

import { spawn } from "node:child_process";

const API_BASE = process.env.UNFRAGILE_API_URL || "https://unfragile.ai";
const API_KEY = process.env.UNFRAGILE_API_KEY || "";
// monitoring traffic is measured, never learned from (see index.ts)
const MONITOR: Record<string, string> = process.env.UNFRAGILE_MONITOR ? { "x-unfragile-monitor": process.env.UNFRAGILE_MONITOR } : {};

type Verdict = "trusted" | "caution" | "unverified" | "flagged";
interface VerifyResponse {
  verdict?: Verdict;
  summary?: string;
  identity?: { matched?: boolean; canonical?: string | null; verifiedBuilder?: boolean; typosquatRisk?: string | null };
  safety?: { score?: number; dataAccessRisk?: string; permissions?: string[]; flags?: string[] };
  reputation?: { timesInvoked?: number; successRate?: number | null; unfragileRank?: number };
  signature?: string | null;
  signedBy?: string;
  compliance?: { evidenceUrl?: string };
  _links?: { verify_key?: string };
}

const C = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
  green: "\x1b[32m", yellow: "\x1b[33m", red: "\x1b[31m", gray: "\x1b[90m",
};
const isTTY = process.stdout.isTTY;
const paint = (s: string, ...codes: string[]) => (isTTY ? codes.join("") + s + C.reset : s);

// ── package-argument parser: mirrors app/src/lib/harness/agent-api.ts packageTargetFromCommand (#449) ──
const NPM_NAME = /^(?:@[A-Za-z0-9~-][A-Za-z0-9._~-]*\/)?[A-Za-z0-9~-][A-Za-z0-9._~-]*$/;
const isValidNpmName = (n: string) => n.length > 0 && n.length <= 214 && NPM_NAME.test(n);
const NPM_VALUE_FLAGS = new Set(["--registry", "--cache", "--userconfig", "--prefix", "-w", "--workspace", "--tag", "-c", "--call"]);
const UV_VALUE_FLAGS = new Set(["--with", "-w", "--python", "-p", "--index", "--index-url", "--extra-index-url", "--default-index", "-i"]);
const PIPX_VALUE_FLAGS = new Set(["--python", "--index-url", "-i", "--pip-args"]);
const PIP_VALUE_FLAGS = new Set(["-i", "--index-url", "--extra-index-url", "-c", "--constraint", "-t", "--target", "--prefix", "--root", "--python", "-f", "--find-links"]);
const INSTALLER = /^(npx|bunx|npm|pnpm|yarn|bun|uvx|uv|pipx|pip[0-9.]*|python[0-9.]*)$/;

/** The package an install/run command (as words) names, as npm:/pypi: target; null when none can be read. */
function packageTargetFromWords(input: string[]): string | null {
  const words = [...input];
  while (words.length > 1 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0])) words.shift();   // FOO=bar npx ...
  if (words.length < 2) return null;
  const bin = words[0].replace(/^.*\//, "").toLowerCase();
  const sub = words[1].toLowerCase();
  let eco: "npm" | "pypi";
  let args: string[];
  let valueFlags: Set<string>;
  let specFlags: Set<string>;   // flags whose value IS the package (npx -p pkg, uvx --from pkg, pipx --spec pkg)
  if (bin === "npx" || bin === "bunx") {
    [eco, args, valueFlags, specFlags] = ["npm", words.slice(1), NPM_VALUE_FLAGS, new Set(["-p", "--package"])];
  } else if (["npm", "pnpm", "yarn", "bun"].includes(bin) && ["i", "install", "add", "dlx", "exec", "x"].includes(sub)) {
    [eco, args, valueFlags, specFlags] = ["npm", words.slice(2), NPM_VALUE_FLAGS, new Set(["-p", "--package"])];
  } else if (bin === "uvx") {
    [eco, args, valueFlags, specFlags] = ["pypi", words.slice(1), UV_VALUE_FLAGS, new Set(["--from"])];
  } else if (bin === "uv" && sub === "tool" && ["install", "run"].includes((words[2] ?? "").toLowerCase())) {
    [eco, args, valueFlags, specFlags] = ["pypi", words.slice(3), UV_VALUE_FLAGS, new Set(["--from"])];
  } else if (bin === "pipx" && ["install", "run"].includes(sub)) {
    [eco, args, valueFlags, specFlags] = ["pypi", words.slice(2), PIPX_VALUE_FLAGS, new Set(["--spec"])];
  } else {
    // pip install / pip3 install / python -m pip install / uv pip install
    const at = words.findIndex((w, i) => /^pip[0-9.]*$/.test(w.replace(/^.*\//, "").toLowerCase()) && (words[i + 1] ?? "").toLowerCase() === "install");
    if (at < 0) return null;
    [eco, args, valueFlags, specFlags] = ["pypi", words.slice(at + 2), PIP_VALUE_FLAGS, new Set()];
    if (args.some((a) => ["-r", "--requirement", "-e", "--editable"].includes(a))) return null;
  }
  let spec: string | null = null;
  for (let i = 0; i < args.length && spec === null; i++) {
    const a = args[i];
    if (a === "--") continue;
    if (a.startsWith("-")) {
      const eq = a.indexOf("=");
      const flag = eq > 0 ? a.slice(0, eq) : a;
      if (specFlags.has(flag)) spec = eq > 0 ? a.slice(eq + 1) : args[i + 1] ?? null;
      else if (eq < 0 && valueFlags.has(flag)) i++;
      continue;
    }
    spec = a;
  }
  if (!spec) return null;
  if (eco === "npm") {
    const at = spec.indexOf("@", spec.startsWith("@") ? 1 : 0);
    const name = at > 0 ? spec.slice(0, at) : spec;
    return isValidNpmName(name) ? `npm:${name}` : null;
  }
  const name = spec.split(/[[<>=!~;@\s]/)[0];
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) ? `pypi:${name}` : null;
}

/** The install target in a wrapped command (e.g. `claude mcp add pg -- npx -y @scope/pg-mcp`): the first installer
 *  invocation whose package argument we can read, else an explicit prefixed ref or URL. Null = no target. */
function extractTarget(args: string[]): string | null {
  for (let i = 0; i < args.length; i++) {
    if (!INSTALLER.test(args[i].replace(/^.*\//, "").toLowerCase())) continue;
    const t = packageTargetFromWords(args.slice(i));
    if (t) return t;
  }
  const ref = args.find((a) => /^(mcp|npm|pypi|github|gh):/.test(a) || /^https?:\/\//.test(a));
  return ref ?? null;
}

const VERDICTS = new Set<Verdict>(["trusted", "caution", "unverified", "flagged"]);

async function callVerify(target: string, intent?: string, action?: string): Promise<VerifyResponse> {
  const res = await fetch(`${API_BASE}/api/v1/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(API_KEY ? { "X-API-Key": API_KEY } : {}), ...MONITOR },
    body: JSON.stringify({ target, intent, action }),
    signal: AbortSignal.timeout(Number(process.env.UNFRAGILE_VERIFY_TIMEOUT_MS) || 15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new Error("malformed reply: not JSON");
  }
  const verdict = (body as VerifyResponse | null)?.verdict;
  if (!body || typeof body !== "object" || !verdict || !VERDICTS.has(verdict)) {
    throw new Error("malformed reply: no valid verdict");
  }
  return body as VerifyResponse;
}

function printVerdict(target: string, v: VerifyResponse): Verdict {
  const verdict = v.verdict as Verdict;
  const badge =
    verdict === "trusted" ? paint(" TRUSTED ", C.bold, C.green)
    : verdict === "caution" ? paint(" CAUTION ", C.bold, C.yellow)
    : verdict === "flagged" ? paint(" FLAGGED ", C.bold, C.red)
    : paint(" UNVERIFIED ", C.bold, C.gray);
  console.error("");
  console.error(`  ${badge}  ${paint(target, C.bold)}`);
  if (v.summary) console.error(`  ${paint(v.summary, C.dim)}`);
  const s = v.safety || {};
  if (s.score != null) console.error(`  ${paint("safety", C.gray)}  ${s.score}/100 · ${s.dataAccessRisk || "?"} data-access risk`);
  if (s.flags?.length) console.error(`  ${paint("flags", C.gray)}   ${paint(s.flags.join(", "), C.yellow)}`);
  const id = v.identity || {};
  if (id.typosquatRisk) console.error(`  ${paint("⚠ resembles '" + id.typosquatRisk + "' — possible typosquat", C.yellow)}`);
  const r = v.reputation || {};
  if (r.timesInvoked) console.error(`  ${paint("rep", C.gray)}     ${r.timesInvoked} invocations${r.successRate != null ? `, ${Math.round(r.successRate * 100)}% success` : ""} · rank ${r.unfragileRank ?? 0}/100`);
  if (v.signature) console.error(`  ${paint("signed by " + (v.signedBy || "unfragile.ai") + " (Ed25519)", C.gray)}`);
  if (v.compliance?.evidenceUrl) console.error(`  ${paint("audit  " + v.compliance.evidenceUrl, C.gray)}`);
  console.error("");
  return verdict;
}

function help(): void {
  console.error(`unfragile — verify-before-invoke guard

INSTALL
  npm i -g @unfragile/mcp-server      # then use 'unfragile …' directly
  # or, no install:  npx -p @unfragile/mcp-server unfragile <args>

USAGE
  unfragile verify <target> [--intent "..."] [--action read|write|execute]
  unfragile guard [--force] [--allow-unverified] -- <command...>

EXAMPLES
  unfragile verify mcp:@modelcontextprotocol/server-postgres
  unfragile verify npm:postmark-mcp
  unfragile guard -- claude mcp add pg -- npx -y @scope/pg-mcp
  unfragile guard -- cursor mcp add ...

BEHAVIOR
  Prints a signed verdict (trusted | caution | unverified | flagged).
  'guard' runs your command only if verification succeeded and the target is not FLAGGED.
  It FAILS CLOSED: if no install target can be read from the command, or verification is
  unavailable (network error, timeout, non-2xx, malformed reply), the command does not run.
  Use --allow-unverified to run it anyway in those cases (loud warning).
  Use --force to override a flagged target (logged).
  Exit 1 on flagged; exit 3 when blocked because verification could not be completed.

ENV
  UNFRAGILE_API_URL  (default https://unfragile.ai)
  UNFRAGILE_API_KEY  (optional — higher rate limits)
  UNFRAGILE_VERIFY_TIMEOUT_MS  (optional — verify timeout, default 15000; a timeout blocks the guard)
  UNFRAGILE_MONITOR  (optional — name your monitor: its checks are measured, never learned from)`);
}

function getFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const cmd = argv[0];

  if (!cmd || cmd === "-h" || cmd === "--help" || cmd === "help") {
    help();
    process.exit(cmd ? 0 : 1);
  }

  if (cmd === "verify") {
    const target = argv[1];
    if (!target || target.startsWith("-")) {
      console.error("error: `unfragile verify <target>` requires a target.");
      process.exit(1);
    }
    const intent = getFlag(argv, "--intent");
    const action = getFlag(argv, "--action");
    try {
      const v = await callVerify(target, intent, action);
      const verdict = printVerdict(target, v);
      process.exit(verdict === "flagged" ? 1 : 0);
    } catch (err) {
      console.error(paint(`  verify unavailable (${err instanceof Error ? err.message : String(err)}) — treat as UNVERIFIED.`, C.yellow));
      process.exit(2);
    }
  }

  if (cmd === "guard") {
    const sep = argv.indexOf("--");
    if (sep < 0 || sep + 1 >= argv.length) {
      console.error("error: `unfragile guard -- <command...>` requires a command after `--`.");
      process.exit(1);
    }
    // guard's own flags live before `--`; the wrapped command's flags are never read as ours
    const own = argv.slice(1, sep);
    const force = own.includes("--force");
    const allowUnverified = own.includes("--allow-unverified");
    const wrapped = argv.slice(sep + 1);
    const target = extractTarget(wrapped);

    /** Verification could not be completed: block (exit 3) unless --allow-unverified. */
    const unverifiable = (why: string): void => {
      if (allowUnverified) {
        console.error(paint(`  ⚠ WARNING: ${why}. Running the command UNVERIFIED because --allow-unverified was given.`, C.bold, C.yellow));
        return;
      }
      console.error(paint(`  ✗ BLOCKED — ${why}. The command was not run.`, C.bold, C.red));
      console.error(paint("  The guard fails closed. Fix the cause and retry, check the target with `unfragile verify <target>`,", C.gray));
      console.error(paint("  or re-run with --allow-unverified (before `--`) to run it without verification.", C.gray));
      process.exit(3);
    };

    if (!target) {
      unverifiable("no install target detected in the command, so nothing could be verified");
    } else {
      try {
        const v = await callVerify(target, undefined, "execute");
        const verdict = printVerdict(target, v);
        if (verdict === "flagged" && !force) {
          console.error(paint("  ✗ BLOCKED — this target is flagged. Re-run with --force to override (logged).", C.bold + C.red));
          process.exit(1);
        }
        if (verdict === "flagged" && force) {
          console.error(paint("  ⚠ proceeding despite FLAGGED verdict (--force).", C.yellow));
        }
      } catch (err) {
        unverifiable(`verification unavailable for ${target} (${err instanceof Error ? err.message : String(err)})`);
      }
    }

    // Pass through to the real command.
    const child = spawn(wrapped[0], wrapped.slice(1), { stdio: "inherit", shell: false });
    child.on("exit", (code) => process.exit(code ?? 0));
    child.on("error", (e) => {
      console.error(`error running command: ${e.message}`);
      process.exit(1);
    });
    return;
  }

  console.error(`unknown command '${cmd}'.\n`);
  help();
  process.exit(1);
}

main();
