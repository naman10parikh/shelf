@AGENTS.md

# shelf: Claude Code operating rules

> [AGENTS.md](AGENTS.md), imported above, is the one source for every coding agent: what shelf is, its CLI and
> MCP tools, its boundaries and its hard refusals. This file keeps only what is specific to Claude Code. The full
> persona is in `identity/SOUL.md`, the expertise in `brain/`, the bootstrap memory in `memory/MEMORY.md`.

## MCP servers

- **`.mcp.json`** (the root file, which a stranger and the Claude Code plugin load) holds only servers that need no
  secret and no relative path: shelf's own server, run straight from GitHub
  (`npx -y -p github:naman10parikh/shelf shelf-mcp`), and context7.
- **`.mcp.dev.json`** holds the maintainer's set: `shelf-local` (the built `dist/`, so run `pnpm build` first), the
  consumed Cloudflare R2 lens (needs `CLOUDFLARE_API_TOKEN`), `github` (needs `GITHUB_PERSONAL_ACCESS_TOKEN`),
  `memory` and `obsidian` (relative paths into this repository). Load them with
  `claude --mcp-config .mcp.dev.json`; add `--strict-mcp-config` to load only that set. shelf's server reads
  `S3_*` and `R2_*` from the environment it inherits; most tools need neither.

## Hooks

`.claude/settings.json` wires `hooks/block-storage-footguns.js` on `PreToolUse` (`Write|Edit|Bash`), and
`hooks/hooks.json` wires the same script for the plugin. It blocks the four storage footguns shelf preaches
against: an object ACL (`P-13`), a user filename in an object key (`P-12`), `new Map()` as upload state (`P-40`) and
a presigned PUT used as a size bound (`P-01`). It exits 2 with a deny reason, logs each block to
`.claude/hook-block.log`, and ignores prose that only quotes a footgun.

## Sub-agents

Two read-only personas in `.claude/agents/`, both shelf's own: `upload-security-auditor` (the write and read
surface of an upload path) and `storage-cost-auditor` (egress, orphaned multiparts, the R2 versus S3 flip). Each
reports per finding with its `brain/` citation. The other personas in that folder are inherited from the fleet.

## Operating model

Read the brain first (`brain/` — EXPERTISE-MAP, BATTLE-TESTED-SCENARIOS, KNOWN-PITFALLS, OPINIONS,
GAPS-AND-DISPUTES, TOOL-MATRIX). Lead with the stance + the flip-condition, cite the S-/P-/O- node.
Validate everything server-side. Verify the number live before betting prod. Act, don't ask. Self-improve
every session. Test as a user. Inherited rules in `.claude/rules/` are glob-loaded every session. Model =
the latest flagship Opus (Claude Code's default; never a model ID), max effort (budget is a no-op constraint — always Opus, never downshift).

## Commit convention

`feat(skill):` · `feat(employee):` · `feat(company):` — so git snap-back works at all 3 granularities.
