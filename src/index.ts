#!/usr/bin/env node

// ─────────────────────────────────────────────────────────────
// Unfragile MCP Server — v0.8: the verified universe, one answer.
//
// Every tool serves from the same verified corpus that powers
// unfragile.ai: crawled weekly, machine-verified with honest tiers,
// Ed25519-signed. Deterministic — same query, same answer, and an
// honest "no confident answer" instead of a guess.
//
// Tools:
//   unfragile_answer   — HEADLINE: intent → ONE verified answer with
//                        evidence + install snippet, or an honest no
//   unfragile_search   — ranked list from the verified corpus
//   unfragile_verify   — verify-before-invoke: conservative verdict +
//                        signed passport. Never invoke `flagged`.
//   unfragile_resolve  — agent-runtime resolution: answer + verdict +
//                        passport + snippet in one call
//   unfragile_passport — raw Ed25519-signed trust passport JSON
//   unfragile_stats    — live corpus census (honest tiers) in JSON
// ─────────────────────────────────────────────────────────────

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const API_BASE = process.env.UNFRAGILE_API_URL || "https://unfragile.ai";
// Monitoring and test traffic (UNFRAGILE_MONITOR=<your monitor's name>) is measured by Unfragile but never learned
// from: it is left out of the search log the ranking is trained on. UNFRAGILE_HEADERS adds any headers as JSON.
const EXTRA: Record<string, string> = {
  ...(() => { try { return JSON.parse(process.env.UNFRAGILE_HEADERS || "{}"); } catch { return {}; } })(),
  ...(process.env.UNFRAGILE_MONITOR ? { "x-unfragile-monitor": process.env.UNFRAGILE_MONITOR } : {}),
};

function log(tool: string, query: string) {
  console.error(`[unfragile] ${tool}: ${query}`);
}

async function get(path: string): Promise<any> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "User-Agent": "@unfragile/mcp-server", ...EXTRA },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
  return body;
}

async function post(path: string, payload: unknown): Promise<any> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "@unfragile/mcp-server", ...EXTRA },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
  return body;
}

function text(s: string) {
  return { content: [{ type: "text" as const, text: s }] };
}

function fmtRecord(r: any): string {
  if (!r) return "(no record)";
  const lines = [
    `**${r.name}** (${r.envelope})`,
    `  tier: ${r.verification?.status} · score ${r.verification?.score}/100 · ${r.verification?.signedPassport ? "signed passport ✓" : "unsigned"}`,
  ];
  if (r.official) lines.push(`  official record of publisher "${r.publisher}"`);
  if (r.adoption?.downloadsMonthly) lines.push(`  adoption: ${r.adoption.downloadsMonthly} monthly downloads`);
  else if (r.adoption?.stars) lines.push(`  adoption: ${r.adoption.stars} GitHub stars`);
  if (r.install) lines.push(`  install: ${r.install}`);
  if (r.url) lines.push(`  evidence page: ${r.url}`);
  if (r.repoUrl) lines.push(`  source: ${r.repoUrl}`);
  return lines.join("\n");
}

const server = new McpServer({
  name: "unfragile",
  version: "0.10.2",
});

server.tool(
  "unfragile_answer",
  "THE headline call: describe what you need and get ONE verified answer from the Unfragile corpus — fresh (crawled weekly), tested (machine-verified with honest tiers), signed (Ed25519 trust passport) — plus a paste-ready install snippet and honest alternatives. Deterministic: same query, same answer. If nothing qualifies, returns an honest 'no confident answer' instead of a guess — trust the abstention.",
  { query: z.string().describe("What you need, e.g. 'query postgres' or 'stripe payments'") },
  async ({ query }) => {
    log("answer", query);
    const d = await get(`/api/answer?q=${encodeURIComponent(query)}`);
    if (!d.answer) {
      return text(
        `No confident answer for "${query}" — the verified corpus (${d.corpus?.size ?? "?"} records) has nothing that covers this well enough to recommend. ${d.noConfidentAnswer?.reason ?? ""}\nDo NOT treat this as an endorsement of anything; consider rephrasing with the task or vendor name.`,
      );
    }
    const a = d.answer;
    const alts = (d.alternatives ?? [])
      .map(
        (x: any) =>
          `  - ${x.name} (${x.score}/100${x.status && !String(x.status).includes("verified") ? ", not yet verified" : ""})${x.url ? ` ${x.url}` : ""}`,
      )
      .join("\n");
    return text(
      [
        `THE ANSWER for "${query}":`,
        ``,
        `**${a.name}**`,
        `${a.why}`,
        `  evidence: ${a.evidence.tested} · score ${a.evidence.score}/100 · ${a.evidence.signed ? "signed passport ✓" : "unsigned"}${a.evidence.fresh ? ` · ${a.evidence.fresh}` : ""}${a.evidence.adoption ? ` · ${a.evidence.adoption}` : ""}`,
        a.install ? `  install: ${a.install}` : "",
        a.url ? `  evidence page: ${a.url}` : "",
        alts ? `\nAlso close:\n${alts}` : "",
        ``,
        `Answered deterministically from ${d.corpus?.size ?? "?"} verified-corpus records — no LLM in the loop · rankings are never for sale.`,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  },
);

server.tool(
  "unfragile_search",
  "Ranked results from the verified corpus with per-record evidence (tier, score, signed passport, adoption, install). Use when a list is wanted rather than the single best answer — for the single answer, use unfragile_answer.",
  {
    query: z.string().describe("Search query"),
    limit: z.number().min(1).max(20).optional().describe("Max results (default 5)"),
  },
  async ({ query, limit }) => {
    log("search", query);
    const d = await get(`/api/v1/search?q=${encodeURIComponent(query)}&limit=${limit ?? 5}`);
    if (!d.results?.length) return text(`No results for "${query}" in the verified corpus.`);
    return text(
      `Results for "${query}" (${d.corpus?.size ?? "?"}-record verified corpus):\n\n` +
        d.results.map((r: any, i: number) => `${i + 1}. ${fmtRecord(r)}`).join("\n\n"),
    );
  },
);

server.tool(
  "unfragile_find",
  "Find the tool ACTION that does what you need, across 2.2 million actions read from MCP servers, APIs, CLIs, SDKs, models, robots and devices. Say the task in plain words ('refund a payment', 'move the robot arm home', 'what's on my calendar tomorrow'); meaning search + word search, fused and ranked by measured trust. Every result carries its label: verified and signed · official · checked: not enough evidence yet · found in code, not yet checked · demo or tutorial · failed its last check. Never invoke a 'failed' result; treat 'checked' and 'found in code' as review-first.",
  {
    task: z.string().describe("What you need done, in plain words"),
    limit: z.number().min(1).max(20).optional().describe("Max results (default 5)"),
    answer: z.boolean().optional().describe("Also return a written answer: the products that do it, each cited to its maker's own pages (default false)"),
    search: z.string().max(160).optional().describe("Optional: your own 3–10 word search phrase. Skips our understanding step — faster, and the same input always gives the same results"),
    intent: z.enum(["product", "action"]).optional().describe("With search: 'product' (which product does X) or 'action' (the one operation to call)"),
    named: z.array(z.string()).max(5).optional().describe("With search: products the task names (e.g. ['stripe']), so they lead"),
  },
  async ({ task, limit, answer, search, intent, named }) => {
    log("find", task);
    const extra = search ? `&search=${encodeURIComponent(search)}${intent ? `&intent=${intent}` : ""}${named?.length ? `&named=${encodeURIComponent(named.join(","))}` : ""}` : "";
    const d = await get(`/api/v1/find?q=${encodeURIComponent(task)}&k=${limit ?? 5}${answer ? "&answer=1" : ""}${extra}`);
    if (!d.results?.length) return text(`Nothing found for "${task}".`);
    // one line per PRODUCT (the answer unit): its official doors first, then the best action and its label
    const lines = d.results.map((r: any, i: number) => {
      const doors = (r.doors ?? []).filter((x: any) => x.official).slice(0, 3).map((x: any) => `${x.kind}: ${x.name}${x.link ? ` (${x.link})` : ""}`);
      const act = r.actions?.[0];
      return `${i + 1}. ${r.product ?? r.name}${r.vendor ? ` — ${r.vendor}` : ""}${r.named ? " (named)" : ""}` +
        (act ? `\n   action: ${act.action} [${r.label}] — ${act.description}` : `\n   [${r.label}] ${r.description ?? ""}`) +
        (doors.length ? `\n   official doors: ${doors.join(" · ")}` : "") +
        (r.links?.docs ? `\n   docs: ${r.links.docs}` : r.website ? `\n   website: ${r.website}` : "") +
        (r.source?.install ? `\n   install: ${r.source.install}` : "") +
        `\n   passport: ${r.url ?? "none yet (not verified)"}`;
    });
    const a = d.answer;
    const head = a
      ? a.error
        ? `ANSWER: unavailable (${a.error})\n\n`
        : `ANSWER${d.searched_as ? ` (read as: ${d.searched_as})` : ""}: ${a.summary}\n` +
          (a.products ?? []).map((p: any, i: number) => `  ${i + 1}. ${p.name}${p.vendor ? ` — ${p.vendor}` : ""}: ${p.what}${p.retired ? " (retired)" : ""}`).join("\n") +
          (a.question ? `\nQuestion back: ${a.question}` : "") +
          ((a.sources ?? []).length ? `\nSources: ${(a.sources as any[]).map((s: any) => `[${s.n}] ${s.url}`).join(" ")}` : "") + "\n\n"
      : "";
    return text(`${head}Products for "${task}" (${d.method}):\n\n${lines.join("\n\n")}\n\nLabels are the instruments' verdict and are never changed by ranking.`);
  },
);

server.tool(
  "unfragile_verify",
  "Verify a tool, MCP server, or package BEFORE invoking or installing it. Returns a conservative verdict — trusted | caution | unverified | flagged — with the record's Ed25519-signed trust passport attached (verifiable offline against https://unfragile.ai/api/v1/trust-passport-public-key). RULE: never invoke or install a `flagged` target; treat `unverified` as review-first.",
  { target: z.string().describe("Target identity, e.g. 'npm:@stripe/mcp', a package name, or a record id") },
  async ({ target }) => {
    log("verify", target);
    const d = await post(`/api/v1/verify`, { target });
    return text(
      [
        `VERDICT for ${target}: **${String(d.verdict).toUpperCase()}**`,
        `  ${d.reason}`,
        d.record ? `\n${fmtRecord(d.record)}` : "\n(not found in the verified corpus — unknown ≠ safe)",
        d.passport
          ? `\nSigned passport attached (signedAt ${d.passport.signedAt ?? "?"}). Verify offline via the published public key.`
          : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  },
);

server.tool(
  "unfragile_resolve",
  "Agent-runtime resolution: one intent in, one verified record out — with verdict, Ed25519-signed passport, and a paste-ready invocation snippet in a single call. Returns an honest abstention when nothing qualifies.",
  { intent: z.string().describe("The task, e.g. 'send a slack message from an agent'") },
  async ({ intent }) => {
    log("resolve", intent);
    const d = await post(`/api/v1/resolve`, { intent });
    if (!d.resolved) {
      return text(
        `No confident resolution for "${intent}" — ${d.noConfidentAnswer?.reason ?? "nothing qualifies"}. Do not invoke a guess.`,
      );
    }
    const r = d.resolved;
    return text(
      [
        `RESOLVED "${intent}" → **${r.name}** (verdict: ${r.verdict})`,
        r.why ? `  ${r.why}` : "",
        fmtRecord(r),
        r.passport ? `  signed passport: attached (verify offline)` : `  signed passport: none`,
        (d.alternatives ?? []).length
          ? `\nAlternatives: ${(d.alternatives as any[]).map((x) => x.name).join(" · ")}`
          : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  },
);

server.tool(
  "unfragile_passport",
  "Fetch the raw Ed25519-signed trust passport JSON for a record (by record page slug, record id, or npm package). For programmatic policy checks; verify offline against the published public key.",
  { slug: z.string().describe("Record page slug, record id (npm:…), or package name") },
  async ({ slug }) => {
    log("passport", slug);
    const d = await get(`/api/v1/passport/${encodeURIComponent(slug)}`);
    return text(JSON.stringify(d.passport ?? d, null, 2));
  },
);

server.tool(
  "unfragile_stats",
  "Live census of the verified corpus with honest tiers: listed, machine-verified, signed passports, official records, by envelope.",
  {},
  async () => {
    log("stats", "-");
    const d = await get(`/api/v1/stats`);
    return text(JSON.stringify(d.corpus ?? d, null, 2));
  },
);

// ─── Start ───────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[unfragile] MCP server v0.9.1 — search for humans, agents and robots");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
