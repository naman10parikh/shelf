#!/usr/bin/env node
// rsi.workflow.js — shelf's deterministic ($0, tokenless) RSI loop (E4 / dsip.json / PLAN §11).
//
//   node workflows/rsi.workflow.js --deterministic     # the 6-step loop, real (clean) run
//   node workflows/rsi.workflow.js --deterministic --plant-drift   # inject a stale price + an archived
//                                                                    # tool → proves the drift-watch detects
//   node workflows/rsi.workflow.js --deterministic --json          # machine-readable
//
// THE LOOP (deterministic half — ENABLED now; the Claude half is DEFERRED behind CLAUDE_CODE_OAUTH_TOKEN,
// D8, expected dark):
//   1. refresh-brain          — re-index brain/ (the Memory layer) and count nodes.
//   2. re-verify-tool-matrix  — DRIFT-WATCH: diff the live source of truth (src/lib/cost.ts PRICING +
//      + drift-watch              the tool-status watchlist) against workflows/snapshots/tool-matrix.json.
//                                Flags: a price that drifted, a V-entry past its half-life, and any tool
//                                that went ARCHIVED/EOL (the P-39 bucket-antivirus-function class). String/
//                                version diff only — no tokens. This vertical's numbers drift fast (O-28).
//   3. run-eval-pyramid       — `node eval/run.mjs --level 1 --level 2` as the regression immune system.
//   4. propose                — emit the drift deltas as a PROPOSAL (does NOT commit).
//   5. test-gate              — a proposal may only land if eval stayed green (snap-back if it regresses).
//   6. commit                 — GATED. The deterministic half never auto-commits; the Claude half (deferred)
//                                would write the corrected brain prose / new golden task under the token.
//
// Exit 0 when all 6 steps complete (drift DETECTED is a successful run — the loop's job is to find drift and
// propose, not to be drift-free). Exit non-zero only if a step ERRORS (e.g. eval regressed) or, under
// --plant-drift, if the planted drift was NOT detected (that would mean the watch is broken).

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const BRAIN_DIR = resolve(REPO_ROOT, "brain");
const SNAPSHOT = resolve(__dirname, "snapshots", "tool-matrix.json");
const COST_LIB = resolve(REPO_ROOT, "src", "lib", "cost.ts");
const EVAL_RUNNER = resolve(REPO_ROOT, "eval", "run.mjs");

const args = process.argv.slice(2);
const DETERMINISTIC = args.includes("--deterministic");
const PLANT_DRIFT = args.includes("--plant-drift");
const JSON_MODE = args.includes("--json");
const SKIP_EVAL = args.includes("--skip-eval"); // internal: lets --plant-drift run fast without the full pyramid

const log = (...m) => {
  if (!JSON_MODE) console.log(...m);
};

// ---------- step 1: refresh-brain ----------
function refreshBrain() {
  const files = existsSync(BRAIN_DIR) ? readdirSync(BRAIN_DIR).filter((f) => f.endsWith(".md")) : [];
  let nodes = 0;
  for (const f of files) {
    const text = readFileSync(resolve(BRAIN_DIR, f), "utf8");
    // count S-/P-/O-/V-/JTBD- heading-ids as a proxy for "nodes indexed"
    nodes += (text.match(/^#{2,4}\s+(SCENARIO\s+\d+|[POV]-\d+|JTBD-\d+|Dispute\s+[A-Z])/gim) ?? []).length;
  }
  return { step: "refresh-brain", ok: files.length > 0, brainFiles: files.length, nodesIndexed: nodes };
}

// ---------- step 2: re-verify-tool-matrix + drift-watch ----------
/** Read the live R2/S3 list prices out of src/lib/cost.ts (the single source of truth). */
function livePricing() {
  const src = readFileSync(COST_LIB, "utf8");
  const r2 = src.match(/r2:\s*\{\s*storagePerGbMo:\s*([\d.]+),\s*egressPerGb:\s*([\d.]+)/);
  const s3 = src.match(/s3:\s*\{\s*storagePerGbMo:\s*([\d.]+),\s*egressPerGb:\s*([\d.]+)/);
  return {
    r2: { storagePerGbMo: r2 ? Number(r2[1]) : NaN, egressPerGb: r2 ? Number(r2[2]) : NaN },
    s3: { storagePerGbMo: s3 ? Number(s3[1]) : NaN, egressPerGb: s3 ? Number(s3[2]) : NaN },
  };
}

function driftWatch() {
  const snap = JSON.parse(readFileSync(SNAPSHOT, "utf8"));
  const drifts = [];

  // (a) PRICE drift: live cost.ts PRICING vs the pinned snapshot.
  const live = livePricing();
  // --plant-drift injects a STALE pin (snapshot says an old R2 price) so the live≠pin diff fires.
  const pinned = JSON.parse(JSON.stringify(snap.pricing));
  if (PLANT_DRIFT) pinned.r2.storagePerGbMo = 0.011; // a deliberately stale R2 price
  for (const provider of ["r2", "s3"]) {
    for (const field of ["storagePerGbMo", "egressPerGb"]) {
      if (live[provider][field] !== pinned[provider][field]) {
        drifts.push({
          kind: "price",
          detail: `${provider}.${field}: live cost.ts = ${live[provider][field]} but snapshot pin = ${pinned[provider][field]} → re-verify the live pricing page (O-28) and re-pin`,
        });
      }
    }
  }

  // (b) ARCHIVED-tool drift: any tool the watchlist marks active that has flipped to archived (P-39 class).
  const toolStatus = JSON.parse(JSON.stringify(snap.toolStatus));
  if (PLANT_DRIFT) toolStatus["rclone"].status = "archived"; // pretend a RECOMMENDED tool went EOL
  for (const [tool, meta] of Object.entries(toolStatus)) {
    if (tool.startsWith("_")) continue;
    // bucket-antivirus-function is archived ON PURPOSE (recorded so shelf never recommends it) — not drift.
    const intentionallyArchived = tool === "bucket-antivirus-function";
    if (meta.status === "archived" && !intentionallyArchived) {
      drifts.push({
        kind: "archived-tool",
        detail: `tool '${tool}' is ARCHIVED/EOL but shelf still recommends it (${meta.role}) → drop it / find a maintained alt (the P-39 ${"bucket-antivirus-function"}-archive class)`,
      });
    }
  }

  // (c) V-entry half-life: facts older than their half-life need re-verification.
  const snapDate = new Date(snap.snapshotDate + "T00:00:00Z").getTime();
  const ageDays = (Date.now() - snapDate) / 86_400_000;
  const staleVEntries = [];
  for (const [id, v] of Object.entries(snap.vEntries)) {
    if (id.startsWith("_")) continue;
    if (ageDays > (v.halfLifeDays ?? Infinity)) staleVEntries.push({ id, fact: v.fact, ageDays: Math.round(ageDays), halfLifeDays: v.halfLifeDays });
  }

  return {
    step: "re-verify-tool-matrix",
    ok: true,
    snapshotDate: snap.snapshotDate,
    snapshotAgeDays: Math.round(ageDays),
    drifts,
    staleVEntries,
    priceDriftDetected: drifts.some((d) => d.kind === "price"),
    archivedToolDetected: drifts.some((d) => d.kind === "archived-tool"),
  };
}

// ---------- step 3: run-eval-pyramid ----------
function runEvalPyramid() {
  if (SKIP_EVAL) return { step: "run-eval-pyramid", ok: true, skipped: true };
  try {
    execFileSync("node", [EVAL_RUNNER, "--level", "1"], { cwd: REPO_ROOT, stdio: JSON_MODE ? "ignore" : "inherit" });
    execFileSync("node", [EVAL_RUNNER, "--level", "2"], { cwd: REPO_ROOT, stdio: JSON_MODE ? "ignore" : "inherit" });
    return { step: "run-eval-pyramid", ok: true, level1: "pass", level2: "pass" };
  } catch {
    return { step: "run-eval-pyramid", ok: false, level1: "?", level2: "fail-or-error" };
  }
}

// ---------- step 4: propose ----------
function propose(watch) {
  const proposals = [];
  for (const d of watch.drifts) proposals.push(`PROPOSE [${d.kind}]: ${d.detail}`);
  for (const s of watch.staleVEntries) proposals.push(`PROPOSE [v-entry-stale]: ${s.id} (${s.ageDays}d > ${s.halfLifeDays}d half-life) — re-verify: ${s.fact}`);
  return { step: "propose", ok: true, committed: false, proposals };
}

// ---------- step 5: test-gate ----------
function testGate(evalStep) {
  // A proposal may only land if the eval pyramid stayed green (snap-back otherwise).
  const wouldLand = evalStep.ok;
  return {
    step: "test-gate",
    ok: true,
    evalGreen: evalStep.ok,
    decision: wouldLand ? "eval green → a proposal COULD land (snap-back armed if it regresses)" : "eval RED → snap-back; no proposal may land",
  };
}

// ---------- step 6: commit (gated) ----------
function commitGated() {
  const claudeTokenSet = Boolean(process.env.CLAUDE_CODE_OAUTH_TOKEN);
  return {
    step: "commit",
    ok: true,
    committed: false,
    note: claudeTokenSet
      ? "CLAUDE_CODE_OAUTH_TOKEN present — the Claude half would now write the corrected brain prose / new golden task (gated by test-gate). Deterministic run still does NOT auto-commit."
      : "deterministic half: NEVER auto-commits (D8). The Claude half is DEFERRED behind CLAUDE_CODE_OAUTH_TOKEN (CHAIRMAN-CHECKLIST) — expected dark.",
  };
}

// ---------- main ----------
function main() {
  if (!DETERMINISTIC) {
    console.error("rsi.workflow.js: pass --deterministic (the $0/tokenless loop). The Claude half is deferred (D8).");
    process.exit(2);
  }

  const steps = [];
  const s1 = refreshBrain();
  log(`[1/6] refresh-brain     → ${s1.brainFiles} brain files, ${s1.nodesIndexed} nodes indexed`);
  steps.push(s1);

  const watch = driftWatch();
  log(`[2/6] re-verify+drift   → snapshot ${watch.snapshotDate} (${watch.snapshotAgeDays}d old); ${watch.drifts.length} drift(s), ${watch.staleVEntries.length} stale V-entry(ies)`);
  for (const d of watch.drifts) log(`        • [${d.kind}] ${d.detail}`);
  steps.push(watch);

  const s3 = runEvalPyramid();
  log(`[3/6] run-eval-pyramid  → ${s3.skipped ? "skipped (--skip-eval)" : s3.ok ? "L1+L2 GREEN" : "RED"}`);
  steps.push(s3);

  const s4 = propose(watch);
  log(`[4/6] propose           → ${s4.proposals.length} proposal(s), committed=${s4.committed}`);
  for (const p of s4.proposals) log(`        • ${p}`);
  steps.push(s4);

  const s5 = testGate(s3);
  log(`[5/6] test-gate         → ${s5.decision}`);
  steps.push(s5);

  const s6 = commitGated();
  log(`[6/6] commit            → committed=${s6.committed} (${s6.note})`);
  steps.push(s6);

  // Success = all 6 steps completed AND eval didn't error AND (under --plant-drift) both planted drifts caught.
  const allStepsOk = steps.every((s) => s.ok);
  let plantedCaught = true;
  if (PLANT_DRIFT) {
    plantedCaught = watch.priceDriftDetected && watch.archivedToolDetected;
    log(`\n--plant-drift self-check: priceDriftDetected=${watch.priceDriftDetected}, archivedToolDetected=${watch.archivedToolDetected} → ${plantedCaught ? "BOTH CAUGHT ✓" : "MISS ✗"}`);
  }
  const pass = allStepsOk && plantedCaught;

  const summary = {
    loop: "deterministic",
    plantDrift: PLANT_DRIFT,
    steps,
    driftsDetected: watch.drifts.length,
    priceDriftDetected: watch.priceDriftDetected,
    archivedToolDetected: watch.archivedToolDetected,
    committed: false,
    pass,
  };

  if (JSON_MODE) {
    process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
  } else {
    log(`\n${pass ? "✓" : "✗"} RSI deterministic loop complete (6/6 steps, $0, committed=false)${PLANT_DRIFT ? " — planted drift " + (plantedCaught ? "detected" : "MISSED") : ""}`);
  }
  process.exit(pass ? 0 : 1);
}

main();
