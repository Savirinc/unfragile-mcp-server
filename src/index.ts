#!/usr/bin/env node

// ─────────────────────────────────────────────────────────────
// Unfragile MCP Server
//
// Query the match graph for AI from any agent (Claude Code,
// Cursor, Windsurf, etc). Every query feeds the graph —
// the graph learns from every interaction.
//
// Tools:
//   search         — Find AI tools by intent/query (with Match Proof)
//   find_mcps      — Discover MCP servers by capability need
//   get_artifact   — Get full details + capabilities for an artifact
//   resolve_capability — Resolve capability:// URIs to trusted artifacts
//   trust_passport — Get machine-readable trust passport for an artifact
//   compare        — Compare two artifacts side-by-side
//   find_stack     — Assemble a complete harness stack for a use case
//   feedback       — Report success/failure to close the learning loop
//   subscribe      — Set up persistent watch for new tools
//   unsubscribe    — Cancel a persistent watch
// ─────────────────────────────────────────────────────────────

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const API_BASE = process.env.UNFRAGILE_API_URL || "https://unfragile.ai";
const API_KEY = process.env.UNFRAGILE_API_KEY || "";
const SOURCE = "mcp-server";

function log(tool: string, query: string) {
  console.error(`[unfragile] ${tool}: ${query}`);
}

// ─── API Client ──────────────────────────────────────────────

interface SearchMatch {
  artifact: {
    id: string;
    name: string;
    type: string;
    url: string;
    slug: string;
    description: string;
    categories: string[];
    pricing: { model: string; free: boolean };
    verified: boolean;
    unfragileRank: number;
    pageUrl: string;
  };
  capabilities: Array<{
    name: string;
    description: string;
    matchScore: number;
    bestFor: string[];
    limitations: string[];
  }>;
  matchGraph: {
    timesMatched: number;
    successRate: number;
    topIntents: string[];
  };
  compositeScore: number;
  matchProof?: {
    reasoning: string;
    confidence: { score: number; percentile: number; topDimension: string };
    evidence: { timesMatched: number; successRate: number; topIntents: string[] };
  };
}

interface SearchResponse {
  query: string;
  intent: { type: string; category: string; refined: string };
  matches: SearchMatch[];
  matchCount: number;
  graphSignal: {
    gapDetected: boolean;
    queryId: string;
    matchRecordIds?: string[];
  };
}

interface TrustPassportResponse {
  unfragile: {
    version: string;
    artifact: {
      id: string;
      slug: string;
      name: string;
      type: string;
      url: string;
      page_url: string;
      status: string;
      verified: boolean;
      categories: string[];
    };
    capabilities: Array<{
      id: string;
      uri: string;
      name: string;
      description: string;
      intents: string[];
      best_for: string[];
      limitations: string[];
      requires: string[];
      confidence: number;
      matches: number;
      success_rate: number;
    }>;
    trust: {
      score: number;
      verified: boolean;
      data_access_risk: "low" | "moderate" | "high";
      permissions: string[];
      failure_modes: string[];
      observed_outcomes: {
        matches: number;
        success_rate: number;
        avg_confidence: number;
        top_intents: string[];
      };
    };
  };
  _links: Record<string, string>;
}

interface ResolveResponse {
  capability: string;
  normalizedQuery: string;
  resolver: {
    id: string;
    mode: string;
    riskMode: string;
    gapDetected: boolean;
  };
  resolutions: Array<{
    artifact: {
      slug: string;
      name: string;
      type: string;
      url: string;
      pageUrl: string;
      passportUrl: string;
      verified: boolean;
      status: string;
      unfragileRank: number;
    };
    resolverScore: number;
    dataAccessRisk: "low" | "moderate" | "high";
    capabilities: Array<{
      name: string;
      matchScore: number;
      limitations: string[];
      requires: string[];
    }>;
    trust: {
      score: number;
      verified: boolean;
      observedMatches: number;
      successRate: number;
      topIntents: string[];
    };
  }>;
  _links: Record<string, string>;
}

async function searchAPI(
  query: string,
  options: { limit?: number; type?: string } = {}
): Promise<SearchResponse> {
  const params = new URLSearchParams({ q: query, source: SOURCE });
  if (options.limit) params.set("limit", String(options.limit));
  if (options.type) params.set("type", options.type);

  const headers: Record<string, string> = { Accept: "application/json" };
  if (API_KEY) headers["X-API-Key"] = API_KEY;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const res = await fetch(`${API_BASE}/api/v1/search?${params}&proof=true`, {
      headers,
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Unfragile API error ${res.status}: ${text}`);
    }

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      throw new Error(
        `Unfragile API returned ${contentType} instead of JSON. The API may be down or returning an error page.`
      );
    }

    return res.json() as Promise<SearchResponse>;
  } finally {
    clearTimeout(timeout);
  }
}

async function passportAPI(slug: string): Promise<TrustPassportResponse> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (API_KEY) headers["X-API-Key"] = API_KEY;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const res = await fetch(`${API_BASE}/api/v1/passport/${encodeURIComponent(slug)}`, {
      headers,
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Unfragile passport API error ${res.status}: ${text}`);
    }

    return res.json() as Promise<TrustPassportResponse>;
  } finally {
    clearTimeout(timeout);
  }
}

async function resolveAPI(
  capability: string,
  options: { limit?: number; type?: string; risk?: string; passport?: boolean } = {}
): Promise<ResolveResponse> {
  const params = new URLSearchParams({ capability, source: SOURCE });
  if (options.limit) params.set("limit", String(options.limit));
  if (options.type) params.set("type", options.type);
  if (options.risk) params.set("risk", options.risk);
  if (options.passport) params.set("passport", "true");

  const headers: Record<string, string> = { Accept: "application/json" };
  if (API_KEY) headers["X-API-Key"] = API_KEY;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const res = await fetch(`${API_BASE}/api/v1/resolve?${params}`, {
      headers,
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Unfragile resolver API error ${res.status}: ${text}`);
    }

    return res.json() as Promise<ResolveResponse>;
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Formatters ──────────────────────────────────────────────

/** Extract a readable name from a URL when artifact.name is a raw URL */
function cleanName(name: string, url: string): string {
  if (!name || /^https?:\/\//.test(name)) {
    // Try to derive name from URL path
    try {
      const u = new URL(url || name);
      const parts = u.pathname.split("/").filter(Boolean);
      // GitHub: owner/repo → repo
      if (u.hostname === "github.com" && parts.length >= 2) {
        return parts[1].replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      }
      // npm/PyPI: package name
      if (parts.length > 0) {
        const last = parts[parts.length - 1];
        return last.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      }
    } catch {}
    // Fallback: strip protocol and trailing slash
    return name.replace(/^https?:\/\//, "").replace(/\/$/, "");
  }
  return name;
}

function formatMatch(m: SearchMatch, rank: number): string {
  const lines: string[] = [];
  const name = cleanName(m.artifact.name, m.artifact.url);
  const verified = m.artifact.verified ? " ✓" : "";
  const pricing = m.artifact.pricing.free ? "Free" : m.artifact.pricing.model;

  lines.push(`### ${rank}. ${name}${verified}`);
  lines.push(`**Type:** ${m.artifact.type} | **Score:** ${m.compositeScore}/100 | **Rank:** ${m.artifact.unfragileRank}/100 | **Pricing:** ${pricing}`);
  lines.push(`**URL:** ${m.artifact.url}`);
  if (m.artifact.description) lines.push(`\n${m.artifact.description}`);

  if (m.capabilities.length > 0) {
    lines.push("\n**Matched Capabilities:**");
    for (const cap of m.capabilities) {
      lines.push(`- **${cap.name}** (${Math.round(cap.matchScore * 100)}% match)`);
      if (cap.description) lines.push(`  ${cap.description.slice(0, 200)}`);
      if (cap.bestFor.length > 0) lines.push(`  Best for: ${cap.bestFor.join(", ")}`);
      if (cap.limitations.length > 0) lines.push(`  Limitations: ${cap.limitations.join(", ")}`);
    }
  }

  if (m.matchProof) {
    lines.push(`\n**Match Proof:**`);
    lines.push(`  ${m.matchProof.reasoning}`);
    lines.push(`  Confidence: ${m.matchProof.confidence.score}/100 (${m.matchProof.confidence.topDimension})`);
    if (m.matchProof.evidence.timesMatched > 0) {
      lines.push(`  Evidence: ${m.matchProof.evidence.timesMatched} matches, ${Math.round(m.matchProof.evidence.successRate * 100)}% success`);
    }
  } else if (m.matchGraph.timesMatched > 0) {
    lines.push(`\n**Graph Signal:** Matched ${m.matchGraph.timesMatched} times | ${Math.round(m.matchGraph.successRate * 100)}% success`);
  }

  lines.push(`\n→ Details: ${m.artifact.pageUrl}`);
  return lines.join("\n");
}

function formatResults(data: SearchResponse): string {
  const lines: string[] = [];
  lines.push(`# Search: "${data.query}"`);
  lines.push(`Intent: ${data.intent.type} | Category: ${data.intent.category || "general"}`);
  lines.push(`Found: ${data.matchCount} matches\n`);

  if (data.matches.length === 0) {
    lines.push("No matches found. This gap has been recorded — the Unfragile graph learns from every query.");
    return lines.join("\n");
  }

  for (let i = 0; i < data.matches.length; i++) {
    lines.push(formatMatch(data.matches[i], i + 1));
    lines.push("");
  }

  // Include matchRecordIds for feedback
  const ids = data.graphSignal.matchRecordIds;
  if (ids && ids.length > 0) {
    lines.push(`\n_Match record IDs (for feedback): ${ids.join(", ")}_`);
  }

  return lines.join("\n");
}

function formatPassport(data: TrustPassportResponse): string {
  const p = data.unfragile;
  const lines: string[] = [];
  lines.push(`# Trust Passport: ${p.artifact.name}`);
  lines.push(`**Type:** ${p.artifact.type} | **Trust Score:** ${p.trust.score}/100 | **Verified:** ${p.trust.verified ? "Yes ✓" : "No"}`);
  lines.push(`**Data access risk:** ${p.trust.data_access_risk}`);
  lines.push(`**URL:** ${p.artifact.url}`);

  if (p.trust.permissions.length > 0) {
    lines.push(`\n## Permissions / Requirements`);
    for (const permission of p.trust.permissions) lines.push(`- ${permission}`);
  }

  if (p.trust.failure_modes.length > 0) {
    lines.push(`\n## Known Failure Modes`);
    for (const failure of p.trust.failure_modes) lines.push(`- ${failure}`);
  }

  lines.push(`\n## Observed Outcomes`);
  lines.push(`- Matches: ${p.trust.observed_outcomes.matches}`);
  lines.push(`- Success rate: ${Math.round(p.trust.observed_outcomes.success_rate * 100)}%`);
  lines.push(`- Avg confidence: ${Math.round(p.trust.observed_outcomes.avg_confidence * 100)}%`);
  if (p.trust.observed_outcomes.top_intents.length > 0) {
    lines.push(`- Top intents: ${p.trust.observed_outcomes.top_intents.join(", ")}`);
  }

  if (p.capabilities.length > 0) {
    lines.push(`\n## Capability URIs`);
    for (const cap of p.capabilities.slice(0, 8)) {
      lines.push(`- \`${cap.uri}\` — ${cap.name} (${Math.round(cap.confidence * 100)}% confidence)`);
    }
  }

  lines.push(`\n→ Full passport JSON: ${data._links.self}`);
  lines.push(`→ Artifact page: ${p.artifact.page_url}`);
  return lines.join("\n");
}

function formatResolve(data: ResolveResponse): string {
  const lines: string[] = [];
  lines.push(`# Resolve: ${data.capability}`);
  lines.push(`Normalized query: ${data.normalizedQuery}`);
  lines.push(`Mode: ${data.resolver.mode} | Risk mode: ${data.resolver.riskMode}`);

  if (data.resolutions.length === 0) {
    lines.push("\nNo trusted artifacts resolved for this capability. This is a demand gap.");
    return lines.join("\n");
  }

  for (let i = 0; i < data.resolutions.length; i++) {
    const r = data.resolutions[i];
    const verified = r.artifact.verified ? " ✓" : "";
    lines.push(`\n## ${i + 1}. ${r.artifact.name}${verified}`);
    lines.push(`**Type:** ${r.artifact.type} | **Resolver score:** ${r.resolverScore}/100 | **Trust:** ${r.trust.score}/100 | **Risk:** ${r.dataAccessRisk}`);
    lines.push(`**URL:** ${r.artifact.url}`);
    if (r.capabilities.length > 0) {
      lines.push("**Matched capabilities:**");
      for (const cap of r.capabilities.slice(0, 4)) {
        lines.push(`- ${cap.name} (${Math.round(cap.matchScore * 100)}% match)`);
        if (cap.requires.length > 0) lines.push(`  Requires: ${cap.requires.join(", ")}`);
        if (cap.limitations.length > 0) lines.push(`  Limitations: ${cap.limitations.join(", ")}`);
      }
    }
    if (r.trust.observedMatches > 0) {
      lines.push(`Observed outcomes: ${r.trust.observedMatches} matches, ${Math.round(r.trust.successRate * 100)}% success`);
    }
    lines.push(`Passport: ${r.artifact.passportUrl}`);
  }

  return lines.join("\n");
}

// ─── MCP Server ──────────────────────────────────────────────

const server = new McpServer({
  name: "unfragile",
  version: "0.3.0",
});

// Tool 1: General search
server.tool(
  "search",
  "Search the Unfragile match graph for AI tools, frameworks, APIs, MCP servers, agents, and more. Returns ranked results with capability matches and graph signals. Every query feeds the graph.",
  {
    query: z.string().min(2).max(500).describe("What you're looking for (e.g., 'best framework for building AI agents', 'MCP server for database access')"),
    limit: z.number().min(1).max(20).default(5).describe("Max results to return"),
    type: z.enum(["agent", "api", "app", "benchmark", "cli", "dataset", "extension", "finetune", "framework", "mcp", "model", "platform", "product", "prompt", "repo", "skill", "template", "webapp", "workflow"]).optional().describe("Filter by artifact type"),
  },
  async ({ query, limit, type }) => {
    log("search", query);
    try {
      const data = await searchAPI(query, { limit, type });
      return { content: [{ type: "text" as const, text: formatResults(data) }] };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  }
);

// Tool 2: Find MCP servers
server.tool(
  "find_mcps",
  "Find MCP servers by capability need. Use this when you need to discover MCP servers for specific integrations (e.g., databases, APIs, cloud services). Returns MCP servers ranked by capability match.",
  {
    need: z.string().min(2).max(500).describe("What capability you need (e.g., 'Postgres database access', 'Slack messaging', 'GitHub repository management')"),
    limit: z.number().min(1).max(20).default(5).describe("Max results"),
  },
  async ({ need, limit }) => {
    log("find_mcps", need);
    try {
      const data = await searchAPI(`MCP server for ${need}`, { limit, type: "mcp" });
      const text = formatResults(data);
      return { content: [{ type: "text" as const, text }] };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  }
);

// Tool 3: Get artifact details
server.tool(
  "get_artifact",
  "Get full details and capabilities for a specific AI artifact by name or slug. Uses search-based lookup (best-effort name matching — may return a different artifact for ambiguous names like 'express'). Use this to understand what an artifact can do before adding it to your stack.",
  {
    name: z.string().min(1).max(200).describe("Artifact name or slug (e.g., 'cursor', 'langchain', 'claude-code')"),
  },
  async ({ name }) => {
    log("get_artifact", name);
    try {
      const data = await searchAPI(name, { limit: 3 });
      // Find best match by name
      const match = data.matches.find(
        (m) =>
          m.artifact.name.toLowerCase() === name.toLowerCase() ||
          m.artifact.slug === name.toLowerCase().replace(/\s+/g, "-")
      ) || data.matches[0];

      if (!match) {
        return { content: [{ type: "text" as const, text: `No artifact found matching "${name}".` }] };
      }

      const lines: string[] = [];
      const artName = cleanName(match.artifact.name, match.artifact.url);
      lines.push(`# ${artName}`);
      lines.push(`**Type:** ${match.artifact.type} | **UnfragileRank:** ${match.artifact.unfragileRank}/100`);
      lines.push(`**URL:** ${match.artifact.url}`);
      lines.push(`**Verified:** ${match.artifact.verified ? "Yes ✓" : "No"}`);
      lines.push(`**Pricing:** ${match.artifact.pricing.free ? "Free" : match.artifact.pricing.model}`);
      lines.push(`**Categories:** ${match.artifact.categories.join(", ")}`);
      if (match.artifact.description) lines.push(`\n${match.artifact.description}`);

      if (match.capabilities.length > 0) {
        lines.push("\n## Capabilities");
        for (const cap of match.capabilities) {
          lines.push(`\n### ${cap.name}`);
          if (cap.description) lines.push(cap.description);
          if (cap.bestFor.length > 0) lines.push(`\n**Best for:** ${cap.bestFor.join(", ")}`);
          if (cap.limitations.length > 0) lines.push(`**Limitations:** ${cap.limitations.join(", ")}`);
        }
      }

      if (match.matchGraph.timesMatched > 0) {
        lines.push(`\n## Graph Signal`);
        lines.push(`Matched ${match.matchGraph.timesMatched} times | ${Math.round(match.matchGraph.successRate * 100)}% success rate`);
        if (match.matchGraph.topIntents.length > 0) {
          lines.push(`Top intents: ${match.matchGraph.topIntents.join(", ")}`);
        }
      }

      lines.push(`\n→ Full details: ${match.artifact.pageUrl}`);

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  }
);

// Tool 4: Resolve capability
server.tool(
  "resolve_capability",
  "Resolve a capability:// URI or natural-language capability into ranked AI artifacts. This is Unfragile's capability DNS primitive. Use when an agent knows what capability it needs and must choose the safest current artifact at runtime.",
  {
    capability: z.string().min(2).max(500).describe("Capability URI or phrase, e.g. 'capability://database.postgres.query.readonly' or 'read-only Postgres database access'"),
    limit: z.number().min(1).max(20).default(5).describe("Max resolutions"),
    type: z.enum(["agent", "api", "app", "benchmark", "cli", "dataset", "extension", "finetune", "framework", "mcp", "model", "platform", "product", "prompt", "repo", "skill", "template", "webapp", "workflow"]).optional().describe("Filter by artifact type"),
    risk: z.enum(["default", "production", "enterprise", "strict"]).default("default").describe("Risk posture. production/enterprise/strict require stronger quality/status gates."),
  },
  async ({ capability, limit, type, risk }) => {
    log("resolve_capability", capability);
    try {
      const data = await resolveAPI(capability, { limit, type, risk });
      return { content: [{ type: "text" as const, text: formatResolve(data) }] };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  }
);

// Tool 5: Trust passport
server.tool(
  "trust_passport",
  "Get the machine-readable trust passport for an AI artifact. Use this before an agent selects a tool, API, MCP server, model, repo, or framework for a task. Returns capability URIs, permissions, data access risk, known failure modes, observed outcomes, and trust score.",
  {
    slug: z.string().min(1).max(200).describe("Artifact slug (e.g., 'cursor', 'claude-code', 'langchain')"),
  },
  async ({ slug }) => {
    log("trust_passport", slug);
    try {
      const data = await passportAPI(slug);
      return { content: [{ type: "text" as const, text: formatPassport(data) }] };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  }
);

// Tool 6: Compare artifacts
server.tool(
  "compare",
  "Compare two AI artifacts side-by-side. Shows capabilities, pricing, rank, and graph signals for each. Uses search-based lookup (best-effort name matching). Use this when deciding between alternatives.",
  {
    artifact_a: z.string().min(1).max(200).describe("First artifact name (e.g., 'cursor')"),
    artifact_b: z.string().min(1).max(200).describe("Second artifact name (e.g., 'windsurf')"),
  },
  async ({ artifact_a, artifact_b }) => {
    log("compare", `${artifact_a} vs ${artifact_b}`);
    try {
      const [dataA, dataB] = await Promise.all([
        searchAPI(artifact_a, { limit: 1 }),
        searchAPI(artifact_b, { limit: 1 }),
      ]);

      const matchA = dataA.matches[0];
      const matchB = dataB.matches[0];

      if (!matchA && !matchB) {
        return { content: [{ type: "text" as const, text: `Neither "${artifact_a}" nor "${artifact_b}" found.` }] };
      }

      const nameA = matchA ? cleanName(matchA.artifact.name, matchA.artifact.url) : artifact_a;
      const nameB = matchB ? cleanName(matchB.artifact.name, matchB.artifact.url) : artifact_b;

      const lines: string[] = [];
      lines.push(`# Compare: ${nameA} vs ${nameB}\n`);

      const row = (label: string, a: string, b: string) =>
        `| ${label} | ${a} | ${b} |`;

      lines.push(`| | ${nameA} | ${nameB} |`);
      lines.push(`|---|---|---|`);

      if (matchA && matchB) {
        lines.push(row("Type", matchA.artifact.type, matchB.artifact.type));
        lines.push(row("UnfragileRank", `${matchA.artifact.unfragileRank}/100`, `${matchB.artifact.unfragileRank}/100`));
        lines.push(row("Pricing", matchA.artifact.pricing.free ? "Free" : matchA.artifact.pricing.model, matchB.artifact.pricing.free ? "Free" : matchB.artifact.pricing.model));
        lines.push(row("Verified", matchA.artifact.verified ? "✓" : "No", matchB.artifact.verified ? "✓" : "No"));
        lines.push(row("Times Matched", String(matchA.matchGraph.timesMatched), String(matchB.matchGraph.timesMatched)));
        lines.push(row("Capabilities", String(matchA.capabilities.length), String(matchB.capabilities.length)));

        lines.push(`\n## ${nameA} Capabilities`);
        for (const cap of matchA.capabilities) {
          lines.push(`- **${cap.name}**: ${cap.description.slice(0, 150)}`);
        }

        lines.push(`\n## ${nameB} Capabilities`);
        for (const cap of matchB.capabilities) {
          lines.push(`- **${cap.name}**: ${cap.description.slice(0, 150)}`);
        }

        lines.push(`\n→ Full comparison: https://unfragile.ai/compare/${matchA.artifact.slug}-vs-${matchB.artifact.slug}`);
      }

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  }
);

// Tool 7: Find harness stack
server.tool(
  "find_stack",
  "Assemble a complete AI harness stack for a use case. Given a description of what you're building, returns recommended tools across harness layers: orchestration, tools/MCPs, memory, guardrails, context assembly, and evaluation. This is the key differentiator — Unfragile understands that modern AI systems are composed of 5-15 tools working together.",
  {
    description: z.string().min(10).max(1000).describe("What you're building (e.g., 'a customer support agent that connects to our Postgres database and Slack, with memory of past conversations')"),
    focus: z.enum(["full", "tools-only", "infrastructure"]).default("full").describe("Stack focus: 'full' = all layers, 'tools-only' = just MCPs and integrations, 'infrastructure' = frameworks and platforms"),
  },
  async ({ description, focus }) => {
    log("find_stack", description);
    try {
      // Parallel queries across harness layers
      const layers = focus === "tools-only"
        ? [
            { name: "MCP Servers / Tools", query: `MCP server for ${description}`, type: "mcp" as const },
            { name: "APIs", query: `API for ${description}`, type: "api" as const },
            { name: "Extensions", query: `extension for ${description}`, type: "extension" as const },
          ]
        : focus === "infrastructure"
        ? [
            { name: "Frameworks", query: `framework for ${description}`, type: "framework" as const },
            { name: "Platforms", query: `platform for ${description}`, type: "platform" as const },
            { name: "CLI Tools", query: `CLI for ${description}`, type: "cli" as const },
          ]
        : [
            { name: "Orchestration / Framework", query: `agent framework for ${description}`, type: "framework" as const },
            { name: "MCP Servers / Tools", query: `MCP server for ${description}`, type: "mcp" as const },
            { name: "APIs", query: `API for ${description}`, type: "api" as const },
            { name: "Agents", query: `agent for ${description}`, type: "agent" as const },
            { name: "CLI Tools", query: `CLI tool for ${description}`, type: "cli" as const },
          ];

      const results = await Promise.all(
        layers.map(async (layer) => {
          try {
            const data = await searchAPI(layer.query, { limit: 3, type: layer.type });
            return { layer: layer.name, matches: data.matches };
          } catch {
            return { layer: layer.name, matches: [] };
          }
        })
      );

      const lines: string[] = [];
      lines.push(`# Harness Stack for: ${description}\n`);
      lines.push(`> Every AI system is a harness — the model is just one component.`);
      lines.push(`> Here's a recommended stack assembled from the Unfragile match graph.\n`);

      let totalTools = 0;
      for (const { layer, matches } of results) {
        if (matches.length === 0) continue;
        totalTools += matches.length;

        lines.push(`## ${layer}\n`);
        for (const m of matches) {
          const mName = cleanName(m.artifact.name, m.artifact.url);
          const verified = m.artifact.verified ? " ✓" : "";
          const pricing = m.artifact.pricing.free ? "Free" : m.artifact.pricing.model;
          lines.push(`**${mName}${verified}** — ${pricing} | Rank: ${m.artifact.unfragileRank}/100`);
          if (m.artifact.description) lines.push(`${m.artifact.description.slice(0, 200)}`);
          if (m.capabilities.length > 0) {
            const capNames = m.capabilities.slice(0, 3).map((c) => c.name).join(", ");
            lines.push(`Key capabilities: ${capNames}`);
          }
          lines.push(`→ ${m.artifact.url}\n`);
        }
      }

      if (totalTools === 0) {
        lines.push("No matching tools found for this use case. This gap has been recorded — the Unfragile graph learns from every query.");
      } else {
        lines.push(`---`);
        lines.push(`*${totalTools} tools across ${results.filter((r) => r.matches.length > 0).length} harness layers. Every query improves the graph.*`);
        lines.push(`*Browse more: https://unfragile.ai/hub*`);
      }

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  }
);

// Tool 8: Feedback — close the learning loop
server.tool(
  "feedback",
  "Report whether a recommended tool worked or not. This closes the learning loop — the Unfragile graph uses this feedback to improve future recommendations. Call this after trying a tool from search results.",
  {
    matchRecordId: z.string().min(1).describe("Match record ID from search results (shown at the bottom of search output)"),
    outcome: z.enum(["success", "failure"]).describe("Did the recommended tool work for your use case?"),
    comment: z.string().max(500).optional().describe("Optional: brief note on why it worked or didn't"),
  },
  async ({ matchRecordId, outcome, comment }) => {
    log("feedback", `${matchRecordId} → ${outcome}`);
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (API_KEY) headers["X-API-Key"] = API_KEY;

      const body: Record<string, unknown> = {
        matchRecordId,
        outcome: outcome === "success" ? "success" : "failure",
        clickedThrough: true,
        source: SOURCE,
      };
      if (comment) body.comment = comment;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);

      try {
        const res = await fetch(`${API_BASE}/api/feedback`, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (!res.ok) {
          const text = await res.text();
          throw new Error(`Feedback API error ${res.status}: ${text}`);
        }
      } finally {
        clearTimeout(timeout);
      }

      return {
        content: [{
          type: "text" as const,
          text: `Feedback recorded: ${outcome}. The Unfragile graph will use this to improve future recommendations. Thank you!`,
        }],
      };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Error sending feedback: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  }
);

// Tool 9: Subscribe — create a monitor
server.tool(
  "subscribe",
  "Set up a persistent watch for new AI tools matching a query. Get notified daily when something new appears in the Unfragile graph. Requires at least one notification channel (email or webhook).",
  {
    query: z.string().min(2).max(500).describe("What to watch for (e.g., 'new MCP server for Postgres', 'framework for building AI agents')"),
    type: z.enum(["agent", "api", "app", "benchmark", "cli", "dataset", "extension", "finetune", "framework", "mcp", "model", "platform", "product", "prompt", "repo", "skill", "template", "webapp", "workflow"]).optional().describe("Only watch for this artifact type"),
    email: z.string().email().optional().describe("Email address for notifications"),
    webhook: z.string().url().optional().describe("Webhook URL for notifications (receives POST with new matches)"),
  },
  async ({ query, type, email, webhook }) => {
    log("subscribe", query);

    if (!email && !webhook) {
      return {
        content: [{ type: "text" as const, text: "Error: At least one notification channel required. Provide 'email' and/or 'webhook'." }],
        isError: true,
      };
    }

    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (API_KEY) headers["X-API-Key"] = API_KEY;

      const body: Record<string, unknown> = {
        query,
        notify: { email, webhook },
        source: SOURCE,
      };
      if (type) body.type = type;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);

      try {
        const res = await fetch(`${API_BASE}/api/v1/monitor`, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || `API error ${res.status}`);
        }

        const lines: string[] = [];
        lines.push(`# Monitor Created`);
        lines.push(`**ID:** ${data.id}`);
        lines.push(`**Watching for:** ${data.query}`);
        if (data.typeFilter) lines.push(`**Type filter:** ${data.typeFilter}`);
        lines.push(`**Frequency:** Daily`);
        if (email) lines.push(`**Email alerts:** ${email}`);
        if (webhook) lines.push(`**Webhook:** ${webhook}`);
        lines.push(`**Expires:** ${data.expiresAt.slice(0, 10)} (90 days)`);
        lines.push(`\n_Save the monitor ID to unsubscribe later._`);

        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
      } finally {
        clearTimeout(timeout);
      }
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Error creating monitor: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  }
);

// Tool 10: Unsubscribe — delete a monitor
server.tool(
  "unsubscribe",
  "Cancel a persistent watch (monitor). Use the monitor ID returned from subscribe.",
  {
    monitorId: z.string().min(1).describe("Monitor ID from subscribe (e.g., 'mon_...')"),
  },
  async ({ monitorId }) => {
    log("unsubscribe", monitorId);
    try {
      const headers: Record<string, string> = {};
      if (API_KEY) headers["X-API-Key"] = API_KEY;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);

      try {
        const res = await fetch(`${API_BASE}/api/v1/monitor?id=${encodeURIComponent(monitorId)}`, {
          method: "DELETE",
          headers,
          signal: controller.signal,
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || `API error ${res.status}`);
        }

        return {
          content: [{ type: "text" as const, text: `Monitor ${monitorId} cancelled. You will no longer receive alerts for this watch.` }],
        };
      } finally {
        clearTimeout(timeout);
      }
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Error cancelling monitor: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  }
);

// ─── Start ───────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[unfragile] MCP server started");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
