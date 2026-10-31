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
// ─────────────────────────────────────────────────────────────

import { spawn } from "node:child_process";

const API_BASE = process.env.UNFRAGILE_API_URL || "https://unfragile.ai";
const API_KEY = process.env.UNFRAGILE_API_KEY || "";

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

/** Pull the most likely install target out of a wrapped command's args. */
function extractTarget(args: string[]): string | null {
  const joined = args.join(" ");
  // npx [-y] <pkg>   (the common MCP-add shape)
  const npx = joined.match(/npx\s+(?:-y\s+|--yes\s+)?(@?[\w./-]+)/);
  if (npx) return `npm:${npx[1]}`;
  // uvx / pipx <pkg>
  const uvx = joined.match(/\b(?:uvx|pipx run)\s+(@?[\w./-]+)/);
  if (uvx) return `pypi:${uvx[1]}`;
  // an explicit prefixed ref or URL anywhere in the args
  const ref = args.find((a) => /^(mcp|npm|pypi|github|gh):/.test(a) || /^https?:\/\//.test(a));
  if (ref) return ref;
  return null;
}

async function callVerify(target: string, intent?: string, action?: string): Promise<VerifyResponse> {
  const res = await fetch(`${API_BASE}/api/v1/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(API_KEY ? { "X-API-Key": API_KEY } : {}) },
    body: JSON.stringify({ target, intent, action }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as VerifyResponse;
}

function printVerdict(target: string, v: VerifyResponse): Verdict {
  const verdict = (v.verdict || "unverified") as Verdict;
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
  unfragile guard [--force] -- <command...>

EXAMPLES
  unfragile verify mcp:@modelcontextprotocol/server-postgres
  unfragile verify npm:postmark-mcp
  unfragile guard -- claude mcp add pg -- npx -y @scope/pg-mcp
  unfragile guard -- cursor mcp add ...

BEHAVIOR
  Prints a signed verdict (trusted | caution | unverified | flagged).
  'guard' runs your command only if the target is not FLAGGED.
  Use --force to override a flagged target (logged). Exit 1 on flagged/block.

ENV
  UNFRAGILE_API_URL  (default https://unfragile.ai)
  UNFRAGILE_API_KEY  (optional — higher rate limits)`);
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
    const force = argv.includes("--force");
    const sep = argv.indexOf("--");
    if (sep < 0 || sep + 1 >= argv.length) {
      console.error("error: `unfragile guard -- <command...>` requires a command after `--`.");
      process.exit(1);
    }
    const wrapped = argv.slice(sep + 1);
    const target = extractTarget(wrapped);

    if (!target) {
      console.error(paint("  no install target detected in command — running unguarded.", C.gray));
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
        console.error(paint(`  verify unavailable (${err instanceof Error ? err.message : String(err)}) — proceeding unguarded.`, C.yellow));
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
