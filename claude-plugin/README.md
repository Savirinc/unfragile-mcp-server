# Unfragile for Claude Code

Unfragile finds the AI infrastructure or agent tool for a task (search APIs, models, inference, browsers, harnesses,
compute, and the MCP servers, APIs, CLIs, SDKs and models in our index) and labels each result by our checks. Every
answer carries an Ed25519-signed receipt you can check offline.

## Install

In Claude Code:

```
/plugin marketplace add Savirinc/unfragile-mcp-server
/plugin install unfragile@unfragile
```

On Claude Code 2.1.275 or later, one step: `/plugin install unfragile --marketplace Savirinc/unfragile-mcp-server`.

## What this plugin adds

- **The hosted Unfragile MCP server** at `https://unfragile.ai/api/mcp`, the same server as the Unfragile connector in
  Claude's directory. Its four tools are read-only:
  - `unfragile_find`: find the product, and the specific tool action, that does a task.
  - `unfragile_verify`: our verdict on a tool, MCP server or package (`trusted`, `caution`, `unverified` or `flagged`),
    with the reason and its signed passport.
  - `unfragile_resolve`: one checked record for a task, with a paste-ready install line, or a plain statement that
    nothing qualifies.
  - `unfragile_passport`: the raw signed passport for a record, for policy checks.
- **Two skills** that tell Claude when to use those tools: choosing infrastructure or a tool for a task, and checking a
  package or MCP server before installing it.

## What it sends, and the free terms

The plugin runs nothing on your machine. When Claude uses a tool, your question (or the package name being checked) is
sent to `https://unfragile.ai/api/mcp`, and the answer comes back. No key and no account: free without a key, up to 300
questions a day. Privacy: https://unfragile.ai/privacy. Terms: https://unfragile.ai/terms.

## Check a receipt yourself

Receipts and passports are signed with Ed25519. The public key is at
https://unfragile.ai/api/v1/trust-passport-public-key, and https://unfragile.ai/docs/receipts shows how to check one.

## Other ways to install

Claude Code without the plugin: `claude mcp add --transport http unfragile https://unfragile.ai/api/mcp`. Every coding
agent on your machine, asking first: `npx -y -p @unfragile/mcp-server unfragile setup`. More at
https://unfragile.ai/docs/mcp.
