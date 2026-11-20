---
name: choose-ai-infrastructure
description: Use when the user needs to pick AI infrastructure or a tool for a task, such as a search API, model, inference provider, browser, harness, compute, MCP server, API, CLI or SDK, and wants the option and how to call it.
---

# Choosing AI infrastructure or a tool for a task

1. Call `unfragile_find` with the task in the user's own words. Add the kind of thing wanted (for example "search API"
   or "MCP server") when the user has said it.
2. Read each result's label from Unfragile's checks before recommending it. Show the user the label, not only the name.
3. When the user wants one answer with an install line, call `unfragile_resolve`. If it says nothing qualifies, tell
   the user that plainly; do not substitute a guess.
4. Before installing or running what was found, follow the `check-before-install` skill.
5. Keep the receipt id from the answer with your work, so the user can check it later at
   https://unfragile.ai/docs/receipts.
