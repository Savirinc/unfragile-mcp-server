---
name: check-before-install
description: Use before installing, adding or running an MCP server, npm or PyPI package, CLI or other tool the user has not used before, to get Unfragile's verdict and the reason.
---

# Checking a package or MCP server before installing it

1. Call `unfragile_verify` with the package or server identifier (for example `npm:@scope/name`, a PyPI name, or the
   record page slug).
2. Act on the verdict:
   - `trusted`: proceed, and keep the receipt id with your work.
   - `caution` or `unverified`: show the user the verdict and the reason before installing, and let them decide.
     Unknown is never trusted.
   - `flagged`: it failed Unfragile's checks. Do not install or invoke it; tell the user why.
3. Treat "found in code, not yet checked" as review-first.
4. For a policy check that needs the signed record itself, call `unfragile_passport` and check its signature against
   https://unfragile.ai/api/v1/trust-passport-public-key.
