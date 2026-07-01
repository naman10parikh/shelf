#!/usr/bin/env node
// sandbox/boot.mjs — the E2B Firecracker sandbox-boot acceptance (the Sandbox/Infra component, PLAN §3
// component 11 / HARNESS-OVERRIDES §11 / MASTER-TODOS row 11). This is the REAL isolated-runtime proof:
// it ACTUALLY BOOTS an ephemeral E2B microVM, `npm pack`s the real `shelf` CLI and installs it INSIDE the
// VM (the SAME binary the fleet ships), runs the REAL load-bearing `shelf validate` verb INSIDE the sandbox
// twice — a good PNG → rc=0 (accepted) and an HTML-as-PNG spoof → rc≠0 (REJECTED, the O-02/P-07 magic-byte
// gate that backs the acceptance test) — measures the cold start (≤500ms target), records a line to
// logs/runs.jsonl, and tears the sandbox down.
//
// WHY `validate` (not upload/get): the Sandbox-component gate is "a real Firecracker boot runs a real shelf
// verb in-VM rc=0" — NOT "the object round-trip hits real R2". A remote E2B microVM cannot reach the CI's
// localhost:9000 MinIO, and the live-R2 upload/get round-trip needs R2_* creds. So this boot exercises the
// CORE, backend-free shelf value in-VM ($0, tokenless): magic-byte validation — the exact reject the
// acceptance merge gate relies on. This mirrors pigeon/sandbox/boot.mjs choosing its backend-free
// `send-test --test-mode` verb for the same gate. The LIVE-R2 round-trip (presign→upload→signed-URL
// 403/200→TTL→oversize/type-reject) stays the ADDITIVE Form 2 (eval/acceptance/form2-e2b.mjs), which flips
// this cell's live half 🔄→✅ once R2_* land (item F5 / CHAIRMAN-CHECKLIST). Both halves are honest.
//
// Gating (D15/RQ-8): this is the SANDBOX-COMPONENT gate, NOT the merge gate. The merge gate is Form 1
// (eval/acceptance/form1-minio.test.ts, MinIO, $0, no creds) + `shelf eval` L1/L2 — they need NO E2B key.
// If E2B_API_KEY is ABSENT, this runs the SAME `shelf validate` assertions LOCALLY ($0 host fallback, D15)
// so the additive CI job is meaningful and NEVER blocks on a cred. When the key IS present (inherited from
// energy per D7) a real Firecracker boot runs.
//
// Mirrors pigeon/sandbox/boot.mjs (the Sandbox.create + in-VM-verb pattern) and shelf's own
// eval/acceptance/form2-e2b.mjs (the npm-pack-install-in-VM convention), adapted to shelf's validation domain.

import { readFileSync, appendFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const RUNS_LOG = join(REPO_ROOT, "logs", "runs.jsonl");
const CLI = "dist/index.js";
const COLD_START_TARGET_MS = 500;

// The two fixtures the in-VM verb exercises. hello.png is a real 1×1 PNG (must PASS); fake.png is
// HTML-renamed-.png (the classic stored-XSS spoof — must be REJECTED by magic bytes, O-02/P-07).
const GOOD_FIXTURE = join("eval", "fixtures", "hello.png");
const BAD_FIXTURE = join("eval", "fixtures", "fake.png");

/** Load shelf's gitignored .env into process.env (the E2B SDK reads E2B_API_KEY from env). Never logs values. */
function loadDotEnv() {
  try {
    for (const line of readFileSync(join(REPO_ROOT, ".env"), "utf8").split("\n")) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch {
    // no .env — rely on the ambient environment (CI sets E2B_API_KEY as a secret).
  }
}

/**
 * Append a sandbox-boot telemetry row to logs/runs.jsonl (append-only). Never throws.
 * @param {Record<string, unknown>} row
 */
function logRow(row) {
  try {
    mkdirSync(dirname(RUNS_LOG), { recursive: true });
    appendFileSync(
      RUNS_LOG,
      JSON.stringify({
        ts: new Date().toISOString(),
        verb: "sandbox-boot",
        model: process.env.ANTHROPIC_MODEL || "claude-opus-4-8[1m]",
        ...row,
      }) + "\n",
    );
  } catch {
    // best-effort telemetry
  }
}

/** @param {string} msg */
function note(msg) {
  process.stderr.write(`[shelf-sandbox] ${msg}\n`);
}

/** Run the built CLI on the host; return {status, out}. Never throws (we assert on the status). */
function cliHost(args) {
  try {
    const out = execFileSync("node", [CLI, ...args], { cwd: REPO_ROOT, encoding: "utf8" });
    return { status: 0, out };
  } catch (e) {
    return { status: e.status ?? 1, out: (e.stdout ?? "") + (e.stderr ?? "") };
  }
}

/**
 * The $0 LOCAL fallback (no E2B key): run the SAME `shelf validate` assertions on the built CLI on the
 * host — good fixture → rc=0, bad fixture → rc≠0. Keeps the boot logic exercised end-to-end so the
 * additive CI job is meaningful even without a cred.
 */
function runLocalFallback() {
  const t0 = performance.now();
  const good = cliHost(["validate", GOOD_FIXTURE, "--json"]);
  const bad = cliHost(["validate", BAD_FIXTURE, "--json"]);
  const localMs = Math.round((performance.now() - t0) * 10) / 10;

  const goodOk = good.status === 0; // real PNG accepted
  const badRejected = bad.status !== 0; // HTML-as-PNG rejected (the load-bearing gate)
  const invariantHeld = goodOk && badRejected;

  const result = {
    mode: "local-$0-fallback",
    reason: "E2B_API_KEY absent — ran `shelf validate` on the host (D15 local-first). E2B live boot pending the key.",
    localMs,
    goodOk,
    badRejected,
    invariantHeld,
  };
  logRow(result);
  process.stdout.write(JSON.stringify(result) + "\n");
  if (!invariantHeld) {
    note(`LOCAL INVARIANT FAILED: goodOk=${goodOk} (rc=${good.status}), badRejected=${badRejected} (rc=${bad.status})`);
    process.exit(1);
  }
  note(
    `LOCAL $0 BOOT PASS — validate(good) rc=0, validate(fake.png) rc≠0 (magic-byte reject), ran in ${localMs}ms ` +
      `(E2B live boot pending key)`,
  );
  process.exit(0);
}

/** Parse the `shelf validate --json` verdict out of a stdout blob (the {ok:…} object). */
function parseVerdict(stdout) {
  const start = stdout.indexOf("{");
  const end = stdout.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(stdout.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** The real E2B Firecracker boot: pack + install the real shelf CLI in-VM, run `shelf validate`, assert, tear down. */
async function runE2B() {
  const { Sandbox } = await import("e2b");
  /** @type {import("e2b").Sandbox | null} */
  let sbx = null;
  try {
    // 1) Boot the microVM — MEASURE the cold start (≤500ms target).
    const t0 = performance.now();
    sbx = await Sandbox.create({ timeoutMs: 180_000 });
    const coldStartMs = Math.round((performance.now() - t0) * 10) / 10;
    note(`sandbox booted: ${sbx.sandboxId} (cold start ${coldStartMs}ms, target ≤${COLD_START_TARGET_MS}ms)`);

    // 2) Pack the REAL shelf CLI into a tarball and install it globally IN the VM — the same binary the
    //    fleet ships (mirrors eval/acceptance/form2-e2b.mjs). Build first if dist is missing.
    if (!existsSync(resolve(REPO_ROOT, "dist", "index.js"))) {
      execFileSync("pnpm", ["build"], { cwd: REPO_ROOT, stdio: "inherit" });
    }
    const packOut = execFileSync("npm", ["pack", "--json"], { cwd: REPO_ROOT, encoding: "utf8" });
    const tarballName = JSON.parse(packOut)[0].filename;
    const tarballBytes = readFileSync(resolve(REPO_ROOT, tarballName));
    await sbx.files.write("/tmp/shelf.tgz", tarballBytes);
    await sbx.files.write("/tmp/hello.png", readFileSync(resolve(REPO_ROOT, GOOD_FIXTURE)));
    await sbx.files.write("/tmp/fake.png", readFileSync(resolve(REPO_ROOT, BAD_FIXTURE)));
    const install = await sbx.commands.run("npm install -g /tmp/shelf.tgz", { timeoutMs: 180_000 });
    if (install.exitCode !== 0) {
      throw new Error(`shelf install in sandbox failed (exit ${install.exitCode}): ${install.stderr.slice(0, 300)}`);
    }
    note("real `shelf` CLI packed + installed in-VM");

    // 3) RUN the load-bearing `shelf validate` verb INSIDE the sandbox — good PNG then HTML-as-PNG.
    //    .catch(e => e) because a REJECT is a NON-ZERO exit that e2b surfaces as CommandExitException.
    const good = await sbx.commands.run("shelf validate /tmp/hello.png --json").catch((e) => e);
    const bad = await sbx.commands.run("shelf validate /tmp/fake.png --json").catch((e) => e);

    // 4) Assert THE INVARIANT against the LIVE boot: good rc=0 + ok:true; bad rc≠0 + ok:false.
    const goodOk = good && good.exitCode === 0 && parseVerdict(good.stdout ?? "")?.ok === true;
    const badVerdict = parseVerdict(bad?.stdout ?? "");
    const badRejected = Boolean(bad && bad.exitCode !== 0 && badVerdict && badVerdict.ok === false);
    const invariantHeld = Boolean(goodOk && badRejected);
    const coldStartOk = coldStartMs <= COLD_START_TARGET_MS;

    const result = {
      mode: "e2b-live-boot",
      sandboxId: sbx.sandboxId,
      coldStartMs,
      coldStartOk,
      coldStartTargetMs: COLD_START_TARGET_MS,
      sandboxVerb: "validate",
      goodOk: Boolean(goodOk),
      badRejected,
      badReason: badVerdict?.reasons?.[0] ?? null,
      invariantHeld,
    };
    logRow(result);
    process.stdout.write(JSON.stringify(result) + "\n");

    if (!invariantHeld) {
      note(
        `INVARIANT FAILED: goodOk=${goodOk} (rc=${good?.exitCode}), badRejected=${badRejected} (rc=${bad?.exitCode})`,
      );
      process.exitCode = 1;
    } else {
      note(
        `LIVE BOOT PASS — in-VM \`shelf validate\` good rc=0 (ok:true), fake.png rc≠0 (magic-byte reject, O-02/P-07), ` +
          `cold start ${coldStartMs}ms${coldStartOk ? " (≤500ms ✓)" : " (>500ms — logged)"}`,
      );
    }
  } finally {
    // 5) ALWAYS tear the sandbox down.
    if (sbx) {
      try {
        await sbx.kill();
        note("sandbox torn down");
      } catch (err) {
        note(`teardown warning: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
}

async function main() {
  loadDotEnv();
  // Guard: dist must be built (both paths run the compiled CLI on the host / packed for the VM).
  if (!existsSync(join(REPO_ROOT, CLI))) {
    note(`missing ${CLI} — run \`pnpm build\` first`);
    process.exit(1);
  }
  const hasKey = Boolean(process.env.E2B_API_KEY);
  if (!hasKey) {
    // Honest $0 fallback (NOT a skip-with-nothing): exercise the SAME validate assertions on the host so
    // the boot logic is proven even without an E2B cred. The additive CI job never blocks (exit 0).
    note("E2B_API_KEY absent — running the `shelf validate` assertions LOCALLY ($0 fallback, D15). E2B live boot pending the key.");
    runLocalFallback(); // exits 0 on pass
    return;
  }
  await runE2B();
}

main().catch((err) => {
  process.stderr.write(`[shelf-sandbox] ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
