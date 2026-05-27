# @unfragile/mcp-server

[![Glama MCP score](https://glama.ai/mcp/servers/Savirinc/unfragile-mcp-server/badges/score.svg)](https://glama.ai/mcp/servers/Savirinc/unfragile-mcp-server)
[![npm](https://img.shields.io/npm/v/@unfragile/mcp-server.svg)](https://www.npmjs.com/package/@unfragile/mcp-server)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/Savirinc/unfragile-mcp-server/blob/main/LICENSE)

Query the [Unfragile match graph](https://unfragile.ai) from any AI agent. Find AI artifacts, discover MCP servers, assemble stacks, compare alternatives, and fetch trust passports. Every query feeds the graph.

Unfragile is built for the agent era: humans click links, agents call capabilities. This server gives Claude Code, Cursor, Windsurf, Claude Desktop, and custom MCP clients a runtime discovery and trust layer for AI artifacts.

## Install

### Claude Code

```bash
claude mcp add unfragile -- npx -y @unfragile/mcp-server
```

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

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

### Cursor

Add to `.cursor/mcp.json`:

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

### Windsurf

Add to `~/.codeium/windsurf/mcp_config.json`:

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

| Tool | Description |
|------|-------------|
| `search` | Find AI tools by intent. "best framework for building AI agents" |
| `find_mcps` | Discover MCP servers by capability. "Postgres + Slack integration" |
| `get_artifact` | Get full details + capabilities for a specific artifact |
| `resolve_capability` | Resolve a `capability://...` URI to ranked trusted artifacts |
| `trust_passport` | Get machine-readable trust evidence: capability URIs, permissions, data access risk, failure modes |
| `compare` | Compare two artifacts side-by-side |
| `find_stack` | Assemble a complete harness stack for a use case |
| `feedback` | Report success/failure to improve future routing |
| `subscribe` | Watch for new artifacts matching a capability need |
| `unsubscribe` | Cancel a monitor |

## Examples

Once installed, ask your agent:

- "Find me MCP servers for Postgres and Slack"
- "Resolve capability://database.postgres.query.readonly"
- "What's the best framework for building AI agents?"
- "Compare LangChain vs CrewAI"
- "Get the trust passport for Cursor"
- "I'm building a customer support agent — what tools do I need?"
- "Get details on Cursor's capabilities"

## How it works

The MCP server calls the [Unfragile API](https://unfragile.ai/docs) under the hood. Search and stack queries become match records in the graph. Trust passport requests use `/api/v1/passport/{slug}` to return artifact identity, capability URIs, constraints, permissions, data access risk, observed outcomes, and UnfragileRank evidence.

13,160 active AI artifacts. 106,955 capabilities. 24 populated software categories. The match graph for AI.

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `UNFRAGILE_API_URL` | API base URL | `https://unfragile.ai` |
| `UNFRAGILE_API_KEY` | API key for higher rate limits | (none) |

## License

MIT
