# shelf — HARNESS-OVERRIDES (CP123)

> **Vertical:** Object storage / file handling / CDN / uploads — Cloudflare R2 (zero egress) default ·
> S3-compatible portability contract · AWS-SDK-v3 presigned POST policy · tus (tusd v2.10.0+) resumable ·
> Cloudflare Images / imgproxy transforms · rclone cross-provider · GuardDuty/ClamAV scan pattern.
> **Boundary (hard):** **object storage + file handling ONLY.** DB blobs / transactional `<256K` storage =
> **acorn's** seam (shelf says "store the URI in the DB"; acorn implements the column + RLS — `brain/OPINIONS.md`
> O-09, `Dispute C`). Rate-limit / hot-path KV cache = **echo's** (shelf uses immutable-key + CDN cache for
> *delivery*). Session/identity ("is this user allowed") = **badge's** (shelf mints the signed-URL *capability* +
> scopes the *signing principal*, O-15). Product billing = **penny's**; storage *bill* analysis (`shelf cost`) is
> shelf's product output, not LLM-token tracing (= agentmoney's).
>
> **What this file is.** The vertical-specific DONE-criteria **overrides** vs `audit/HARNESS-CHECKLIST-2026.md`.
> **Wave-V auditors grade against THIS file** (it wins where it differs from the generic checklist). Each row says
> exactly what ✅ requires for shelf, what is 🟡 (not enough), and what is ✅-by-exemption. Grading uses the locked
> calibration (`memory feedback_harness_component_grading_calibration`): ✅ = real + tested/verified with evidence;
> 🟡 = present but unproven; ❌ = absent. Source of every criterion: `PLAN.md` §3 + the six `brain/` artifacts.

---

## Component overrides (the 11 + 2 cross-cutting)

### 1 · Identity
- **1a · Self — ✅ requires:** `identity/SOUL.md` + `identity/BRAND.md` with the **real** storage/platform-engineer
  persona (PLAN §1: defense-in-depth, egress-first, "it's not just `putObject`") — **zero `{{UPPERCASE}}` template
  slots** (the scaffold shipped `{{AGENT_NAME}}`/`{{MISSION}}`/`{{PLATFORM}}`/`{{STRATEGY}}` — they must be gone);
  the one-word symbolic name **`shelf`** + tagline + "powered by Energy"; `CLAUDE.md` non-generic (carries the voice
  + the creed + the acorn/echo/badge boundaries; the `TODO:` stub AND the wrong component-formula — which lists
  `src/auth`/`src/db`/`src/frontend` — both gone). *Evidence:* `grep -rl '{{' identity/ CLAUDE.md` returns
  **nothing**; `grep -c shelf identity/BRAND.md` ≥1; `grep -l 'TODO:\|src/auth\|src/frontend' CLAUDE.md` returns
  nothing.
- **1b · Reachability — ✅ BY EXEMPTION (N/A).** shelf is a **tool-employee** consumed by coding agents + the local
  cockpit, **not** a messaging-channel product. The reachability sub-axis (phone/email/WhatsApp/iMessage/SMS/voice/
  Telegram/Slack/Discord) **does not apply** — the surfaces are **CLI + MCP** (agents) and the **cockpit** (the
  chairman). **Grade ✅, not 🟡** — this is an exemption, not an unmet criterion. (DECISIONS per-repo:
  "Identity-reachability = N/A"; checklist Part B "Dev-tool: identity = N/A".)

### 2 · Memory
- **Override:** the queryable layer indexes **the expertise brain (`brain/`)** — the six Wave-R artifacts — **NOT**
  code/commit history.
- **✅ requires:** `MEMORY.md` bootstrap ≤2,000 tokens (the one-line default stack — R2 default / S3 portability —
  + the "creed" + the acorn/echo boundaries + pointers to the six brain files) **AND** a real BM25 search layer over
  `brain/` exposed as a CLI (`shelf brain <query>` / `scripts/memory-search.sh`) that returns **ranked hits**.
- **🟡 (NOT enough):** a `MEMORY.md` file + `grep` alone. ✅ needs the queryable layer actually returning ranked
  brain hits.
- *Evidence:* `shelf brain "presigned PUT size limit"` returns `BATTLE-TESTED-SCENARIOS.md S6` / `KNOWN-PITFALLS.md
  P-01` in the top 3; `wc -w memory/MEMORY.md` ≤ ~1500.

### 3 · Skills
- **✅ requires:** ≥3 **real** `SKILL.md` in `skills/` (not stubs), each with `## Trigger` + `## Steps` + `## Output`,
  each **encoding a specific OPINION/PITFALL** (the 5 specced in PLAN §4: `presign-upload` (O-14/S6/S7 — POST-policy
  > PUT, exact signed-header set, effective-expiry), `validate-upload` (O-02/O-13/S4/S15 — magic bytes not header,
  resource-consumption caps, random keys, SVG refusal), `set-lifecycle-hygiene` (O-17/S11 — abort-incomplete-multipart
  day-one), `pick-storage-backend` (O-05/Dispute A/S3 — traffic-aware per-workload + flip-condition), `safe-serve`
  (O-11/O-20/S12 — two-sided serve headers + change-the-URL-not-invalidate)); invokable from another harness (energy
  hub).
- *Evidence:* `ls skills/*/SKILL.md | wc -l` ≥3; one skill invoked from energy returns expected output.

### 4 · Tools / CLIs
- **Override:** browser/computer-use is **N/A** — shelf is a *backend storage* employee that operates via the S3
  API / SDK / CLI, **not** a web-operator (documented in AGENTS.md). The "if it touches the web, wire a browser
  tool" clause does not bind shelf. (shelf *guides* the upload-client choice — Uppy / the merged `@uppy/aws-s3`
  plugin, O-26 — but that is the product's UI, not shelf driving a browser.)
- **✅ requires:** the real `shelf` binary (`bin` in `package.json`, `#!/usr/bin/env node`, `--help`/`--version`,
  exit 0/non-zero, `--json` on data commands); the command tree (PLAN §4) implemented **at least through the
  acceptance path** (`shelf presign upload/get` + `shelf upload` + `shelf get` + `shelf validate`); tool list in
  `AGENTS.md` + `/llms.txt`.
- *Evidence:* `shelf --version` exits 0; `shelf presign upload --bucket X --key Y --json` emits parseable JSON;
  `shelf --help` lists every command.

### 5 · Hooks
- **Override (dogfood):** the hook enforces **shelf's own discipline** on shelf's repo — the proof that the storage
  employee obeys storage rules.
- **✅ requires:** `.claude/settings.json` with ≥1 real matcher that **fires when triggered** — concretely a
  **PreToolUse grep-gate that blocks a commit introducing a footgun shelf preaches against**: `ACL:` /
  `'public-read'` on a putObject (P-13/O-16), a user-supplied filename interpolated into an object key (P-12), a
  `new Map()` used for upload state (P-40/O-25), or a presigned **PUT** used to "bound" size (P-01/O-14).
- **🟡 (NOT enough):** a hook script that exists but was never fired/tested.
- *Evidence:* introduce a deliberate `ACL: 'public-read'` (or a `new Map()` upload-state) → the hook blocks the
  commit; remove it → passes; the side effect appears in the hook log.

### 6 · Sub-agents
- **✅ requires:** `.claude/agents/` **flat** (no `agents/agents/` nest); **≥2** real personas with **distinct**
  scopes, callable via `Agent` or a skill — specifically **`upload-security-auditor`** (the write+read surface:
  Content-Type/extension trust, SVG-as-document, polyglot re-encode, zip-bomb/pixel-flood resource caps, random
  server keys, the two-sided serve headers — S4/S5/S15, P-07..P-12) and **`storage-cost-auditor`** (egress-first
  sizing, orphaned multiparts, the R2-vs-S3 per-workload flip, NAT-Gateway/VPC-endpoint, lifecycle hygiene —
  S1/S11/S20, P-24..P-28).
- *Evidence:* `ls .claude/agents/*.md` shows both with distinct `description:`; each invoked on a fixture produces
  its scoped finding.

### 7 · MCPs
- **Override:** shelf ships its **OWN** server exposing the storage vertical's *expertise operations* — it is **not**
  satisfied by the inherited github/context7/memory/obsidian template, NOR by merely *consuming* the Cloudflare R2
  MCP (that is the *lens* shelf uses on the R2 default per O-23; the own server is what shelf *does*).
- **✅ requires:** `.mcp.json` lists ≥1 **own** `shelf` server; tools match PLAN §4 (`presign_upload`/`presign_get`/
  `validate_file`/`set_lifecycle`/`find_orphans`/`estimate_cost`/`pick_backend`/`explain_pitfall`/`search_brain`);
  the consumed **Cloudflare R2 MCP** (`cloudflare/mcp-server-cloudflare`) added with **env refs only** (no live
  keys); a documented dual-mode (stdio local + Streamable-HTTP hosted path, MCP spec 2025-11-25).
- **🟡 (NOT enough):** only the 4 inherited servers; the consumed Cloudflare MCP *without* shelf's own server; a
  server entry that doesn't start.
- *Evidence:* `.mcp.json` has the `shelf` server (no literal keys; the cloudflare entry moved to `.mcp.dev.json`
  in CP158 because it needs a token); an MCP `tools/list`
  JSON-RPC call returns the documented names; `tools/call presign_upload` round-trips. (Note V-12: the R2 MCP's own
  presign-generation is unconfirmed — shelf's `presign_upload` uses AWS-SDK-v3, so the bar never depends on it.)

### 8 · Dispatch (routing + cron)
- **✅ requires (routing):** an internal routing loop OR agentgrid/agentswarm wiring for the multi-step upload run
  (presign → upload → HEAD-revalidate → validate → confirm), **tested** (run the flow, verify ordering); **no bare
  `tmux select-pane`**.
- **✅ requires (routine):** a GitHub Actions `workflow_dispatch` (and/or `schedule`) running (a) the deterministic
  RSI loop AND (b) the **dogfood lifecycle-audit cron** (scan shelf's own demo bucket for orphaned multiparts / a
  missing abort-incomplete rule — O-17/S11) — **ENABLED, not just written** (the #1 fleet-gap lesson; CP117 burned
  on "written ≠ enabled").
- **🟡 (NOT enough):** a workflow file that is commented-out / never run.
- *Evidence:* the workflow has an uncommented `workflow_dispatch:`/`schedule:` **and a recorded run-id** (in
  IMPLEMENTATION-NOTES); the dispatch flow runs the upload steps in order.

### 9 · Evals (Hamel L1/L2/L3 + tests)
- **Override:** golden tasks are lifted from `brain/BATTLE-TESTED-SCENARIOS.md` (S1–S20) — **each scenario's built-in
  "Eval check" line is the objective gate** (the dsip `noSelfGrading:true` rule — never the agent's own opinion that
  it's done). The brain's difficulty maps to Hamel levels: detect→diagnose, fix→remediate+verify (L2),
  design/migrate→build-the-right-thing / no-silent-drift (L3).
- **✅ requires:** **L1** structural assertions pass (`shelf eval`); **L2** ≥3 golden behavioral tasks, **binary**
  pass/fail (the scenario Eval check, F1≥0.8 or κ≥0.6); **L3** trajectory tasks (S3→R2 migration no-drift / WORM
  routing / async-scan design) graded on process; **the acceptance test passes in CI**; Vitest + Playwright
  **red-blocking**; **pass^k (k≥3)**.
- **🟡 (NOT enough):** L1 only; a Likert/opinion judge; pass@1.
- *Evidence:* `shelf eval` green on L1+L2; `eval/` maps **≥10** tasks to S-IDs (GT-1..GT-14, PLAN §6); the
  acceptance CI job is green; the CI-blocking set is GT-1/GT-2/GT-3/GT-4/GT-6/GT-13.

### 10 · Observability
- **Override:** two layers — (a) shelf's **own** run telemetry (it dogfoods the `runs.jsonl` wide event), and (b)
  the storage-cost/audit it produces (`shelf cost`). Per `brain/OPINIONS.md` O-28: the cost output must assert the
  *mechanism* confidently and label the *number* "as of June 2026, verify" — never the all-zero / vendor-as-gospel
  failure.
- **✅ requires:** token/cost + duration + tool-calls per `shelf` run appended to `logs/runs.jsonl` (append-only,
  with a real `trace.id` + a **measured** `durationMs` — NOT the all-zero markers the seed scaffold class ships);
  a `shelf upload` (state-mutating action) records the object key + size + backend + signed-URL-TTL in the
  append-only trail (checklist §10 "audit trail for any state-mutating action").
- **🟡 (NOT enough):** a `runs.jsonl` with all-zero `durationMs` markers; no audit line for the upload mutation.
- *Evidence:* a `shelf presign`/`upload` run appends a real entry to `logs/runs.jsonl` (model+duration+trace.id);
  `runs-view.mjs` aggregates it.

### 11 · Sandbox / Infra
- **Override:** the **real integration point** is the **acceptance test booting a sandbox and running the presigned
  upload→get round-trip against a LIVE R2/S3 bucket, asserting signed-URL access control + size/type enforcement**
  (a live boot, like wikimem's `Sandbox.create` precedent) — not a toy sandbox.
- **✅ requires:** the **live** round-trip (PLAN §5 Form 2) runs in **E2B Firecracker** (or a documented alt): a
  file is presigned, uploaded, fetched **via a signed URL** (GET-without-URL → 403, GET-with → 200, TTL expiry
  honored), and an oversize + wrong-magic-byte upload are **verifiably rejected**, against a **real** bucket; cold
  start ≤500ms **measured**; sandbox **cleaned**.
- **🟡 (NOT enough):** a sandbox template that is never booted; `Sandbox.create` written but not run.
- **Grading note (D10/Q-HS1):** this component is graded on the **live boot itself**; if backend creds (`R2_*`/
  `AWS_*`) are absent at grade time, the Sandbox component is 🟡 (not ✅) **but the acceptance MERGE gate still
  passes via the local-MinIO path** (PLAN §5 Form 1) — the *merge* gate does not depend on E2B/live-R2; the
  *Sandbox component ✅* does. (The two-form split mirrors canary's local-OTLP gate.)
- *Evidence:* an E2B `Sandbox.create` runs `shelf upload` + `shelf get` against a real bucket, asserts the
  signed-URL 403/200 + TTL expiry + the oversize/wrong-type rejection, rc=0, sandbox torn down (run-id logged).

### RSI / open-endedness (cross-cutting)
- **✅ requires:** `dsip.json` conformant (`domain:"object-storage"`, `levels:["agent"]`, `selection:"eval-gated"`,
  `noSelfGrading:true`, snapback `["component","repo"]`, `externalIntelligence.enabled:true`); **L1** (evals exist)
  before ship; **L2** (a nightly/dispatch loop runs + writes diffs) via `workflows/rsi.workflow.js` running the
  **deterministic $0 6-step loop** (refresh-brain → re-verify-tool-matrix **+ price/limit/SDK-bug drift-watch** →
  run-eval-pyramid → propose → test-gate → commit).
- **Override (shelf-specific — the drift-watch):** this vertical's *numbers and platform defaults drift fast* (O-28,
  V-01..V-13): R2/S3 pricing, the boto3 `content-length-range` bug status (V-04), tusd patch level (V-10/V-11),
  CloudFront propagation/cap (V-09), whether the R2 MCP mints presigned URLs (V-12), the S3 platform-default shifts
  (P-13/P-14 — ACLs-disabled, BPA-on). The deterministic loop's `re-verify` step **MUST** re-check the TOOL-MATRIX
  V-entries (not just a version bump) AND flag any tool gone **archived/EOL** (the `bucket-antivirus-function`
  archive class, P-39). ✅ requires the drift-watch present and detecting a planted "archived tool" string.
- **Override (D8):** the **deterministic half ships ENABLED now** at $0/tokenless; the **Claude half is DEFERRED** —
  graded ✅ for the deterministic loop being armed + the Claude path correctly **gated behind
  `CLAUDE_CODE_OAUTH_TOKEN`** (a CHAIRMAN-CHECKLIST item with exact commands). The Claude half being dark is
  **expected, not a miss**.
- *Evidence:* `node workflows/rsi.workflow.js --deterministic` runs at $0, completes the 6 steps, detects a planted
  stale R2-price pin AND a planted "archived tool" string, proposes a diff without committing unless the gate
  passes; the Claude path is conditional on the token.

### Model routing (cross-cutting)
- **✅ requires:** `scripts/budget-manager.sh` present + `settings.local.json` env routing inherited; any sub-agent
  shelf spawns uses **explicit** model routing (no bare defaults). (Under D14 the budget is a no-op constraint —
  always Opus 4.8, max effort — but the mechanism is present.)
- *Evidence:* `scripts/budget-manager.sh status` runs; shelf's own sub-agent invocations pass an explicit model.

---

## Packaging overrides (repo type = dev-tool / meta-employee)
Required surfaces: **CLI + MCP + plugin + skill-set + AGENTS.md + CLAUDE.md + llms.txt + A2A card + packaged
sub-agent.** (checklist Part B table.)
- **AGENTS.md / CLAUDE.md — ✅ requires a REWRITE:** the current `AGENTS.md` is a leftover **wikimem schema**
  ("Domain: personal", `raw/`/`wiki/` dirs, `wikimem lint`) and `CLAUDE.md` is the generic forge stub with `TODO:`
  + the wrong component formula — both must be replaced with shelf-real content (the tool list, the acorn/echo/badge
  **boundaries**, the creed, the voice, browser-use=N/A, what NOT to do). A graded ✅ here means the wikimem leftover
  AND the `TODO:`/`{{}}`/wrong-formula residue are **gone**. *Evidence:* `grep -l 'wiki\|raw/\|Domain: personal'
  AGENTS.md` returns nothing; `grep -l '{{\|TODO:' AGENTS.md CLAUDE.md` returns nothing.
- **`.env.example` — ✅ requires a REWRITE:** the current file carries generic Energy keys (`GOOGLE_PLACES_API_KEY`,
  `TICKETMASTER_API_KEY`) and **none** of the storage backend keys. ✅ = the generic keys gone + Tier A (R2) + Tier E
  (state store) present (PLAN §8), values gitignored. *Evidence:* `grep -l 'GOOGLE_PLACES\|TICKETMASTER'
  .env.example` returns nothing; `grep -c R2_ACCESS_KEY_ID .env.example` ≥1.
- **A2A card — ✅ requires:** `.well-known/agent.json` with `name:shelf` + `description` (object-storage/CDN/uploads
  employee) + `endpoint` (the MCP/StreamableHTTP URL) + `capabilities` (the DELIVERED surfaces: presign/upload/get/
  validate/lifecycle/cost/backend-pick/brain/explain) + `plannedCapabilities` (migrate/scan/serve-config — honest
  stubs until their owning cluster lands; advertised separately so the card never over-claims); tested with one A2A
  call.
- **llms.txt — ✅ requires:** links to AGENTS.md + the 5 skills + the MCP endpoint/tool list + SOUL.md + the brain
  index + the one-line default stack (R2 default / S3 portability) + the acorn/echo/badge boundaries + the
  S-/P-/O- ID index.
- **Framework adapter (`@energy/agent-toolkit`) — N/A** (meta-harnesses only; shelf is a dev-tool employee). Not
  graded.

---

## Product-surface note (shelf IS the object-storage product-surface owner)
shelf is itself the fleet's **Object storage / CDN / file uploads** product-surface owner (checklist Part C2 line:
"Object storage / CDN / file uploads — Cloudflare R2 / AWS S3 / UploadThing / Supabase Storage — **GAP**" — shelf
fills this exact gap). Its product-surface DONE = the acceptance test (presigned upload→get round-trip with
signed-URL access control + size/type/magic-byte rejection) plus the non-footgun defaults shelf bakes in (random
keys, abort-incomplete-multipart lifecycle, two-sided safe-serve headers, CDN-in-front, immutable keys). **The seam
vs the harness "Observability" component (owner: agentmoney) is explicit and load-bearing:** agentmoney = LLM
cost/token-trace per run (`gen_ai.usage.*`); shelf's Observability = its own run telemetry + product-side *storage*
cost analysis (`shelf cost`, egress-first). They never overlap — shelf holds no LLM-token metric. **The seam vs
acorn (database)** is the BLOB-vs-DB line: bytes + the pointer pattern = shelf; the DB column + RLS = acorn (O-09,
Dispute C). **The seam vs echo (rate-limit/cache)** is delivery-cache (shelf: immutable-key + CDN) vs request-cache
(echo).

---

*Grading authority: this file + the locked calibration. Where this file and the generic checklist differ, **this
file wins** for shelf. Maturity = round(1 + 4×coverage) over these cells.*
