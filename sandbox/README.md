# shelf sandbox — the Sandbox/Infra component (MASTER-TODOS row 11)

The isolated-runtime boot for shelf. It boots an E2B Firecracker microVM, `npm pack`s the real
`shelf` CLI and installs it **inside** the VM (the same binary the fleet ships), runs the REAL
load-bearing `shelf validate` verb **inside the sandbox** — a good PNG → rc=0 (accepted) and an
HTML-as-PNG spoof → rc≠0 (**rejected** by magic bytes, the O-02/P-07 gate that backs the acceptance
test) — measures the cold start (≤500ms target), records a line to `logs/runs.jsonl`, and tears the
sandbox down.

This is a **separate sandbox-component gate (RQ-8), NOT the per-PR merge blocker.** The merge gate is
Form 1 (`eval/acceptance/form1-minio.test.ts`, MinIO, $0, no creds) + `shelf eval` (L1/L2) — those
need **no** E2B key (D15 local-first).

## Why `validate` in-VM (and not the object round-trip)

The Sandbox-component gate is "a real Firecracker boot runs a real shelf verb in-VM rc=0" — **not**
"the object round-trip hits real R2". A remote E2B microVM cannot reach the CI's `localhost:9000`
MinIO, and the presign→upload→get round-trip needs `R2_*` (or public-S3) creds. So this boot exercises
shelf's **core, backend-free value** in-VM ($0, tokenless): magic-byte validation — the exact reject
the acceptance merge gate relies on. The **live-R2 round-trip** (presign→upload→signed-URL
403/200→TTL-expiry→oversize/wrong-type reject, cold-start measured) is the **additive Form 2**
(`eval/acceptance/form2-e2b.mjs`), which flips this cell's live half 🔄→✅ once `R2_*` land (item F5 /
`CHAIRMAN-CHECKLIST`). Both halves are honest; neither over-claims.

## Files

| File        | Role                                                                                                                                                                                             |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `boot.mjs`  | The boot script. Real `Sandbox.create` when `E2B_API_KEY` is present (packs + installs the real `shelf` CLI in-VM, runs `shelf validate`); a `$0` host fallback (same assertions) when absent. |
| `README.md` | This file — the alt-sandbox documentation the component requires.                                                                                                                              |

## Run it

```bash
pnpm build              # boot.mjs runs / packs the COMPILED dist/index.js — build first
node sandbox/boot.mjs   # E2B live boot if E2B_API_KEY is set; else the $0 host fallback
# or: pnpm sandbox
```

- **With `E2B_API_KEY`** (inherited from energy per D7): a real Firecracker boot. The `shelf validate`
  verb runs fully in-VM at $0 (no R2 needed); the live-R2 object round-trip half stays 🔄 until `R2_*`
  land (item F5), proven by Form 2.
- **Without the key**: `boot.mjs` runs the identical `shelf validate` assertions on the host ($0,
  good→rc=0 / fake.png→rc≠0), so the CI job is meaningful and never blocks on a cred. Exits 0.

## CI wiring

The `sandbox-boot` job in `.github/workflows/acceptance.yml` is **additive, `push`-only, and
`continue-on-error: true`** — it can never turn the merge gate red. It passes `E2B_API_KEY` from repo
secrets; when the secret is unset it runs the $0 host fallback. The pre-existing `acceptance-live` job
(Form 2, `workflow_dispatch`) remains the live-R2 gate.

## Alt sandboxes (documented, per INFRA-STACK)

E2B is the default, but it is not a lock-in. The same `shelf validate` in-VM flow runs unchanged under
any OCI-compatible microsandbox:

- **Daytona** — dev-environment sandboxes; `daytona create` + run `node sandbox/boot.mjs` inside the
  workspace. Good when you want a persistent, warmable environment.
- **microsandbox** (libkrun, Apache-2.0) — self-hosted Firecracker-class isolation with no vendor
  account. Boot a `node:20-slim` image under microsandbox and run the same script; break-even vs
  managed E2B is ≈11k sandbox-hours/mo (see energy `.claude/harnesses/INFRA-STACK.md`).
- **Plain `docker run`** — `docker run --rm -v "$PWD":/w -w /w node:20-slim node sandbox/boot.mjs`
  runs the boot in an isolated container (the CI ubuntu runner uses the same script directly, no
  Docker layer needed).

## Cold start

E2B Firecracker microVMs cold-start in ~150–300ms. `boot.mjs` measures the actual boot time and logs
`{ verb: "sandbox-boot", coldStartMs, coldStartOk, … }` to `logs/runs.jsonl`.
