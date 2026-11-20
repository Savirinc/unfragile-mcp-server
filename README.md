# @unfragile/mcp-server

**Search for everything an agent can invoke. Every result labelled. For humans, agents and robots.**

[Unfragile](https://unfragile.ai) is the neutral search layer for developers, agents and robots. This package gives any MCP client (Claude Code, Claude Desktop, Cursor, Windsurf, Cline, your own runtime) seven tools over the Unfragile index: the tool actions read from MCP servers, APIs, CLIs, SDKs, models, robots and devices, each checked by machine and labelled with what the check found.

- **Labelled, never softened.** Every result carries one of: `verified and signed` · `official` · `found in code, not yet checked` · `demo or tutorial` · `failed its last check`. Labels are the instruments' verdict; no ranking, model or payment changes them.
- **Signed.** Verified records carry an Ed25519 trust passport you can verify offline against the [published public key](https://unfragile.ai/api/v1/trust-passport-public-key).
- **Honest no.** When nothing fits, `unfragile_find` says so and asks one question back. Retrieval and ranking are deterministic; the one language model in the system writes the single-sentence pick behind `answer: true` and may only choose among labelled results.
- **Free without a key, up to 300 questions a day.** With an Unfragile key, $4 per 1,000 questions ([pricing](https://unfragile.ai/pricing)). Every tool calls the API at unfragile.ai.

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

## Add it to every coding agent on this machine

```bash
npx -p @unfragile/mcp-server unfragile setup --dry-run   # shows what it would add, writes nothing
npx -p @unfragile/mcp-server unfragile setup             # asks before each agent
```

`setup` finds Claude Code, VS Code, Cursor, Windsurf, Gemini CLI, Claude Desktop and Codex, and adds one entry named
`unfragile` to each one you say yes to: the hosted server (`https://unfragile.ai/api/mcp`) by default, or this package
with `--stdio`. It uses each agent's own command where it has one, otherwise merges one key into the agent's config file
after writing a backup. It never touches a model, a base URL, a key or another server's entry. Flags: `--yes`,
`--dry-run`, `--stdio`, `--only=cursor,vscode,…`.

## Tools

| Tool | What it does |
|------|--------------|
| `unfragile_find` | Arguments: `task`, `limit` (1–20), `answer` (boolean). The tool ACTION that does a task, across the actions in our index. Meaning search and word search fused, ranked by measured trust, reranked. Every result labelled. `answer: true` adds one definite pick with its reasoning, or an honest no with one question back. |
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

`guard` extracts the install target from a `claude mcp add` / `npx` / `uvx` / `pip install` command, verifies it, and blocks a `flagged` verdict (unless `--force`, which is logged). Every verdict is Ed25519-signed.

`guard` **fails closed**. If it cannot read an install target from the command, or verification fails (network error, timeout, non-2xx reply, malformed reply), the wrapped command does not run and the guard exits `3` with the reason. To run the command anyway, pass `--allow-unverified` before the `--`; the guard then prints a loud warning and runs it unverified. `--allow-unverified` never overrides a `flagged` verdict.

```bash
# Run unverified on purpose (prints a warning)
npx -p @unfragile/mcp-server unfragile guard --allow-unverified -- claude mcp add pg -- npx -y @scope/pg-mcp
```

| Guard result | Exit | Command runs? |
|---|---|---|
| `trusted` / `caution` / `unverified` verdict | the command's own | yes |
| `flagged` verdict | 1 | no (`--force` overrides) |
| verification failed, or no target in the command | 3 | no (`--allow-unverified` overrides) |

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

## How it works

Every tool calls the [Unfragile API](https://unfragile.ai/docs) (free without a key up to 300 questions a day; with a key, $4 per 1,000): `/api/v1/find`, `/api/answer`, `/api/v1/search`, `/api/v1/verify`, `/api/v1/resolve`, `/api/v1/passport`, `/api/v1/stats`. The search runs on Unfragile's own GPU: a meaning index and a word index over the actions, fused and reranked, with trust as a measured nudge, never a label change. [How we check](https://unfragile.ai/how).

## Environment variables

| Variable | Description | Default |
|----------|-------------|---------|
| `UNFRAGILE_API_URL` | API base URL | `https://unfragile.ai` |
| `UNFRAGILE_MONITOR` | Name your monitoring or test traffic: it is measured, never used to train the ranking | — |
| `UNFRAGILE_HEADERS` | Extra request headers as JSON, e.g. `{"x-team":"qa"}` | — |
| `UNFRAGILE_API_KEY` | Optional key for higher rate limits (CLI guard) | (none) |
| `UNFRAGILE_VERIFY_TIMEOUT_MS` | CLI verify timeout; a timeout blocks `guard` | `15000` |

## Links

- For agents, as markdown: <https://unfragile.ai/agents.md> · for robots: <https://unfragile.ai/robots.md>
- API reference: <https://unfragile.ai/docs>
- How we check and verify a passport offline: <https://unfragile.ai/how>
- Live index numbers: <https://unfragile.ai/api/v1/stats>

## License

MIT
