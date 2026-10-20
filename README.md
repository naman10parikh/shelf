# shelf

<!-- fleet:header:start -->
[![License: MIT](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE) [![Agent-native](https://img.shields.io/badge/agent--native-yes-2f5d8a?style=flat-square)](AGENTS.md) [![MCP server](https://img.shields.io/badge/MCP-server-1e3f60?style=flat-square)](#use-it-from-any-coding-agent) [![Skills](https://img.shields.io/badge/skills-5-2f6b4f?style=flat-square)](skills/)

**File uploads and object storage: presigned, validated, cheap to serve.**

Shelf is an agent-native, recursively self-improving agent employee whose job is storage and uploads. Coding agents use it through its skills, its MCP server and its command line. It improves itself through its own evals and a scheduled improvement loop, and a person reviews every change.

[AGENTS.md](AGENTS.md) · [llms.txt](llms.txt) · [Skills](skills/) · [Security](SECURITY.md) · [Contributing](CONTRIBUTING.md) · [All projects](https://github.com/naman10parikh)
<!-- fleet:header:end -->

Shelf is the file side of an app, run as an agent: presigned uploads, signed-URL access control, magic-byte validation and lifecycle hygiene, with Cloudflare R2 by default and S3 as the portability contract. It is for coding agents, and the people who drive them, whenever an app accepts, stores or serves user files. Put it down, find it fast, pay for it once: a recursively self-improving, agent-native harness built on the Energy harness formula.

<!-- fleet:use:start -->
## Use it from any coding agent

**Claude Code**: the plugin brings the skills, sub-agents, hooks and MCP server.

```
/plugin marketplace add naman10parikh/shelf
/plugin install shelf@shelf
```

**Its MCP server**, in any MCP client:

```bash
claude mcp add --transport stdio shelf -- npx -y -p github:naman10parikh/shelf shelf-mcp
codex mcp add shelf -- npx -y -p github:naman10parikh/shelf shelf-mcp
```

Cursor (`.cursor/mcp.json`), Gemini CLI (`.gemini/settings.json`) and most other clients take the same command as JSON:

```json
{
  "mcpServers": {
    "shelf": {
      "command": "npx",
      "args": [
        "-y",
        "-p",
        "github:naman10parikh/shelf",
        "shelf-mcp"
      ]
    }
  }
}
```

**Gemini CLI**: the extension brings the context and the MCP server.

```bash
gemini extensions install https://github.com/naman10parikh/shelf
```

**One skill** (5 in all, in [skills/](skills/)), in any agent that reads Agent Skills:

```bash
gemini skills install https://github.com/naman10parikh/shelf --path skills/presign-upload
git clone --depth 1 https://github.com/naman10parikh/shelf /tmp/shelf && cp -r /tmp/shelf/skills/presign-upload ~/.claude/skills/
```

**The command line:**

```bash
npx -y -p github:naman10parikh/shelf shelf --help
```

Codex, Cursor, OpenCode, GitHub Copilot and other agents read [AGENTS.md](AGENTS.md); Claude Code reads [CLAUDE.md](CLAUDE.md) and Gemini CLI reads [GEMINI.md](GEMINI.md), which import it. [llms.txt](llms.txt) maps every surface for agents that read first.
<!-- fleet:use:end -->

## Quick start

```bash
git clone https://github.com/naman10parikh/shelf && cd shelf
pnpm install && pnpm build                              # dist/ is built here, never committed
node dist/index.js validate eval/fixtures/hello.png     # ✓ png (image/png), 70 bytes, 1×1
node dist/index.js validate eval/fixtures/fake.png      # ✗ HTML renamed .png, refused by its magic bytes
node dist/index.js validate eval/fixtures/evil.svg      # ✗ SVG from untrusted input, refused (XSS + SSRF)
node dist/index.js cost estimate --egress-gb 5000 --storage-gb 200   # R2 $3.00/mo, S3 $454.60/mo, and when that flips
node dist/index.js backend pick --workload write-heavy  # S3: on R2 the write fees dominate
node dist/index.js brain "presigned put size limit"     # BM25 over the brain: scenario S6, pitfall P-01
S3_ENDPOINT=http://localhost:9000 node dist/index.js presign upload --bucket demo --key avatars/x.png \
  --max-bytes 5000000 --content-type image/png          # a size-bounded POST policy; signing needs no server
pnpm test && pnpm eval                                  # 15 tests; eval L1, L2 (14 golden tasks) and L3 pass
```

Most commands run offline at no cost. The live round-trip (`upload`, `get`, `cors check`, `lifecycle set`) needs a bucket: any S3-compatible endpoint in `S3_ENDPOINT` (a local MinIO works), or `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY`.

## How it works

- **The upload bar.** `shelf upload` checks the file locally, presigns a POST policy bounded by size and type, uploads straight to the bucket, then re-checks size and integrity with a HEAD request. The key is random unless you pass one. `shelf get` reads it back through a short-lived signed URL. The order of steps lives in `src/dispatch/upload-flow.ts`.
- **One core, three surfaces.** The CLI (`src/commands/`) and the MCP server (`src/mcp/server.ts`, nine tools) share one library in `src/lib/`, and the five skills tell an agent when to call which command, so it gets the same answer however it asks.
- **The brain.** Six documents in `brain/` hold the expertise: 13 jobs, 20 field scenarios, 42 pitfalls, 28 opinions, the open debates and the tool matrix. `shelf brain` searches them with BM25, and `shelf explain` opens one by its ID.
- **Guard rails.** A PreToolUse hook blocks four storage footguns in any edit: object ACLs, user filenames in keys, `new Map()` as upload state and a presigned PUT used as a size bound. Every run appends a trace id, its duration and its tool calls to `logs/runs.jsonl`.
- **Proof on every push.** CI runs the tests and the eval pyramid. A MinIO round-trip gates the merge: no signed URL gives 403, a signed URL gives 200, and an oversize file, a fake PNG and an SVG are refused. A separate job boots an E2B microVM and runs `shelf validate` inside it; without an `E2B_API_KEY` it runs the same checks on the host.
- **The loop.** Every day a scheduled workflow runs `workflows/rsi.workflow.js`. It re-reads the brain, compares prices and tool versions with a snapshot to catch drift, runs the evals and writes a proposal to its log. It never commits; a person turns a proposal into a change.

<!-- fleet:anatomy:start -->
## What it is made of

Every project in this fleet is graded on the same 11 harness components and on self-improvement. Each mark is backed by a file you can open.

| Component | Grade | Where |
| --- | --- | --- |
| Identity | ✅ | identity/SOUL.md:1 identity/BRAND.md:15 |
| Memory | ✅ | memory/MEMORY.md:1 src/lib/brain.ts:37 memory/LEARNINGS.md:5 |
| Skills | ✅ | skills/presign-upload/SKILL.md:1 skills/validate-upload/SKILL.md:1 |
| Tools/CLIs | ✅ | package.json:7 src/index.ts:1 |
| Hooks | ✅ | .claude/settings.json:4 hooks/hooks.json:4 hooks/block-storage-footguns.js:1 |
| Sub-agents | ✅ | .claude/agents/upload-security-auditor.md:2 .claude/agents/storage-cost-auditor.md:2 |
| MCPs | ✅ | src/mcp/server.ts:1 package.json:8 .mcp.json:3 |
| Dispatch | ✅ | src/dispatch/upload-flow.ts:35 .github/workflows/rsi.yml:13 |
| Evals | ✅ | eval/run.mjs:1 .github/workflows/acceptance.yml:73 |
| Observability | ✅ | src/lib/observability.ts:3 |
| Sandbox/Infra | 🟡 | sandbox/boot.mjs:1 eval/acceptance/form2-e2b.mjs:17 (E2B boot passes; the live R2 round-trip needs storage keys only the founder holds) |
| RSI / open-endedness | ✅ | dsip.json:1 workflows/rsi.workflow.js:1 .github/workflows/rsi.yml:13 |

✅ real and tested · 🟡 partial, with the reason in the row · ❌ absent
<!-- fleet:anatomy:end -->

<!-- fleet:footer:start -->
## How it improves itself

It carries its own evals and a self-improvement contract, [`dsip.json`](dsip.json) (level L2). A scheduled loop runs the evals, tries a change in a sandbox and opens it for review. A change that lowers a score is not merged, and a person merges every change. Lessons it learns are kept as rules in its memory files.

## Part of a fleet

One of the agent-native, recursively self-improving open-source projects by [Naman Parikh](https://github.com/naman10parikh). Each one is an agent employee that owns one part of an agent's harness or of the product around it.

Siblings: [agentdial](https://github.com/naman10parikh/agentdial) (identity) · [wikimem](https://github.com/naman10parikh/wikimem) (memory) · [skillsmith](https://github.com/naman10parikh/skillsmith) (skills) · [agent-booster](https://github.com/naman10parikh/agent-booster) (tools / CLIs) · [armory](https://github.com/naman10parikh/armory) (MCPs and the component registry) · [agentgrid](https://github.com/naman10parikh/agentgrid) (dispatch) · [agentswarm](https://github.com/naman10parikh/agentswarm) (dispatch) · [agentbench](https://github.com/naman10parikh/agentbench) (evals) · [agentmoney](https://github.com/naman10parikh/agentmoney) (observability) · [claude-harness](https://github.com/naman10parikh/claude-harness) (the whole harness, as a template).

## Contributing and security

Read [CONTRIBUTING.md](CONTRIBUTING.md); AI-assisted pull requests are welcome. Report a vulnerability privately, as [SECURITY.md](SECURITY.md) explains.

## License

MIT, © 2026 Naman Parikh. See [LICENSE](LICENSE).
<!-- fleet:footer:end -->
