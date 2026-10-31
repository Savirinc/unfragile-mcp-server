# @unfragile/mcp-server

**Search for everything an agent can invoke. Every result labelled. For humans, agents and robots.**

[Unfragile](https://unfragile.ai) is the neutral search layer for developers, agents and robots. This package gives any MCP client (Claude Code, Claude Desktop, Cursor, Windsurf, Cline, your own runtime) seven tools over the Unfragile index: 2.2 million tool actions read from MCP servers, APIs, CLIs, SDKs, models, robots and devices, each checked by machine and labelled with what the check found.

- **Labelled, never softened.** Every result carries one of: `verified and signed` · `official` · `found in code, not yet checked` · `demo or tutorial` · `failed its last check`. Labels are the instruments' verdict; no ranking, model or payment changes them.
- **Signed.** Verified records carry an Ed25519 trust passport you can verify offline against the [published public key](https://unfragile.ai/api/v1/trust-passport-public-key).
- **Honest no.** When nothing fits, `unfragile_find` says so and asks one question back. Retrieval and ranking are deterministic; the one language model in the system writes the single-sentence pick behind `answer: true` and may only choose among labelled results.
- **Free, no key.** Every tool calls the public API at unfragile.ai.

Guides: [for agents](https://unfragile.ai/agents) · [for developers](https://unfragile.ai/developers) · [for robots](https://unfragile.ai/robots) · [API reference](https://unfragile.ai/docs)

## Install

One line on a machine with Claude Code (prints the configuration block on any other machine):

```bash
curl -fsSL https://unfragile.ai/install.sh | sh
```

### Claude Code

```bash
claude mcp add unfragile -- npx -y @unfragile/mcp-server
```

### Claude Desktop, Cursor, Windsurf, Cline, any MCP client

Add to the client's MCP configuration (Claude Desktop: `~/Library/Application Support/Claude/claude_desktop_config.json`; Cursor: `.cursor/mcp.json`; Windsurf: `~/.codeium/windsurf/mcp_config.json`):

```json
{
  "mcpServers": {
    "unfragile": {
      "command": "npx",
      "args": ["-y", "@unfragile/mcp-server"]
    }
  }
}
```

## Tools

| Tool | What it does |
|------|--------------|
| `unfragile_find` | **The headline call.** Arguments: `task`, `limit` (1–20), `answer` (boolean). The tool ACTION that does a task, across 2.2 million actions. Meaning search and word search fused, ranked by measured trust, reranked. Every result labelled. `answer: true` adds one definite pick with its reasoning, or an honest no with one question back. |
| `unfragile_answer` | One verified software record for a need, with evidence (tier, score, signed passport, freshness, adoption), a paste-ready install snippet and honest alternatives, or an honest no. |
| `unfragile_search` | A ranked list of software records with per-record evidence, for when a list beats the single pick. |
| `unfragile_verify` | **Verify before invoke.** A conservative verdict for a target, `trusted` · `caution` · `unverified` · `flagged`, with the signed passport attached. Never invoke a `flagged` target; treat `unverified` as review-first. Unknown is never safe. |
| `unfragile_resolve` | One intent in; one record, verdict, signed passport and invocation snippet out, in a single call. |
| `unfragile_passport` | The raw Ed25519-signed trust passport for a record, for programmatic policy checks, verifiable offline. |
| `unfragile_stats` | Live index numbers by door type. |

## The command line: verify before you install

The same package ships an `unfragile` command.

```bash
# Check a target before installing (exit code 1 = flagged, stop)
npx -p @unfragile/mcp-server unfragile verify npm:postmark-mcp

# Guard a real install: verifies the target first, blocks on FLAGGED
npx -p @unfragile/mcp-server unfragile guard -- claude mcp add pg -- npx -y @scope/pg-mcp
```

`guard` extracts the install target from a `claude mcp add` / `npx` / `uvx` command, verifies it, and blocks a `flagged` verdict (unless `--force`, which is logged). Every verdict is Ed25519-signed. If verification is unreachable the CLI says so and treats the target as UNVERIFIED; it never fails silently open.

## Ask your agent

- "Find the tool that refunds a Stripe payment and tell me its label."
- "Which action turns off the living room lights? Verified ones only."
- "Verify npm:some-mcp-package before installing it."
- "Get the signed trust passport for the pick."
- "How big is the index right now?"

## The rules

1. Labels are the instruments' verdict. Read the label before acting on a result.
2. Never invoke a `failed` or `flagged` target. Treat `found in code, not yet checked` as review-first.
3. An honest no is an answer. Do not fill the gap with a guess.
4. Cite the passport. A verified result's `url` is its signed passport.

**Rankings are never for sale.** Vendors may pay to have their own record checked sooner, never to change an answer or a label.

## How it works

Every tool calls the free public [Unfragile API](https://unfragile.ai/docs): `/api/v1/find`, `/api/answer`, `/api/v1/search`, `/api/v1/verify`, `/api/v1/resolve`, `/api/v1/passport`, `/api/v1/stats`. The search runs on Unfragile's own GPU: a meaning index and a word index over the actions, fused and reranked, with trust as a measured nudge, never a label change. [How we check](https://unfragile.ai/how).

## Environment variables

| Variable | Description | Default |
|----------|-------------|---------|
| `UNFRAGILE_API_URL` | API base URL | `https://unfragile.ai` |
| `UNFRAGILE_API_KEY` | Optional key for higher rate limits (CLI guard) | (none) |

## Links

- For agents, as markdown: <https://unfragile.ai/agents.md> · for robots: <https://unfragile.ai/robots.md>
- API reference: <https://unfragile.ai/docs>
- How we check and verify a passport offline: <https://unfragile.ai/how>
- Live index numbers: <https://unfragile.ai/api/v1/stats>

## License

MIT
