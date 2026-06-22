#!/usr/bin/env node
// run.mjs — the eval-pyramid runner `shelf eval` delegates to (E1). Hamel L1/L2/L3, $0/tokenless.
//
//   node eval/run.mjs              # all levels (1 then 2 then 3)
//   node eval/run.mjs --level 1    # L1 structural (vitest)
//   node eval/run.mjs --level 2    # L2 golden behavioral tasks (binary pass/fail, pass^k on CI-blocking)
//   node eval/run.mjs --level 3    # L3 calibrated judge
//   node eval/run.mjs --json       # machine-readable summary
//
// L1 = structural shape (eval/l1-structural.test.ts via vitest).
// L2 = the golden tasks in eval/golden/*.json: each runs a REAL `shelf` command ($0/offline — presign
//      against a dummy S3_ENDPOINT, validate/cost/backend/explain/serve-config/migrate need no backend)
//      and asserts exit code + mustContain/mustNotContain (the scenario's "Eval check" rubric, the dsip
//      noSelfGrading rule). CI-blocking tasks (GT-1/2/3/4/6/13) run pass^k with k=3 — a single trial is
//      not evidence (PLAN §6).
// L3 = the calibrated rubric judge (eval/l3-judge.mjs) — graded against hand labels, not a Likert opinion.

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const CLI = resolve(REPO_ROOT, "dist", "index.js");
const GOLDEN_DIR = resolve(__dirname, "golden");
const L1_TEST = resolve(__dirname, "l1-structural.test.ts");
const L3_JUDGE = resolve(__dirname, "l3-judge.mjs");

const PASS_K = 3; // pass^k for CI-blocking tasks (PLAN §6): k consecutive passes required.

function parseArgs(argv) {
  let level = 0; // 0 = all
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--level") level = Number(argv[++i]) || 0;
    else if (argv[i] === "--json") json = true;
  }
  return { level, json };
}

// ---------- L1 ----------
function runL1() {
  // vitest is the red-blocking structural gate. Inherit stdio so failures are visible; capture status.
  try {
    execFileSync("npx", ["vitest", "run", L1_TEST], { cwd: REPO_ROOT, stdio: "inherit" });
    return { level: 1, pass: true };
  } catch {
    return { level: 1, pass: false };
  }
}

// ---------- L2 ----------
/** Run ONE check (a single CLI invocation) and return {pass, detail}. */
function runCheck(check) {
  const env = { ...process.env, ...(check.env ?? {}) };
  let stdout = "";
  let status = 0;
  try {
    stdout = execFileSync("node", [CLI, ...check.command], { encoding: "utf8", env });
    status = 0;
  } catch (e) {
    const err = e;
    stdout = (err.stdout ?? "") + (err.stderr ?? "");
    status = typeof err.status === "number" ? err.status : 1;
  }

  // Exit-code assertion.
  const wantNonZero = check.expectExit === "nonzero";
  if (wantNonZero && status === 0) return { pass: false, detail: `expected non-zero exit, got 0` };
  if (!wantNonZero && check.expectExit !== undefined && status !== check.expectExit) {
    return { pass: false, detail: `expected exit ${check.expectExit}, got ${status}` };
  }

  const hay = stdout.toLowerCase();

  // JSON field assertions (exact value match on a top-level field).
  if (check.json) {
    let parsed = null;
    try {
      parsed = JSON.parse(stdout);
    } catch {
      return { pass: false, detail: `expected JSON output, could not parse` };
    }
    for (const [k, v] of Object.entries(check.json)) {
      if (JSON.stringify(parsed?.[k]) !== JSON.stringify(v)) {
        return { pass: false, detail: `json.${k} expected ${JSON.stringify(v)}, got ${JSON.stringify(parsed?.[k])}` };
      }
    }
  }

  // Substring assertions (lowercased — the rubric keywords).
  for (const needle of check.mustContain ?? []) {
    if (!hay.includes(String(needle).toLowerCase())) return { pass: false, detail: `output missing "${needle}"` };
  }
  for (const needle of check.mustNotContain ?? []) {
    if (hay.includes(String(needle).toLowerCase())) return { pass: false, detail: `output must NOT contain "${needle}"` };
  }
  return { pass: true, detail: "ok" };
}

/** Run a golden task: all its checks must pass. CI-blocking tasks run pass^k (k consecutive all-pass). */
function runGoldenTask(gt) {
  const k = gt.ciBlocking ? PASS_K : 1;
  const trials = [];
  for (let trial = 0; trial < k; trial++) {
    const checkResults = gt.checks.map((c) => ({ name: c.name, ...runCheck(c) }));
    const trialPass = checkResults.every((r) => r.pass);
    trials.push({ trial, pass: trialPass, checks: checkResults });
    if (!trialPass) break; // pass^k: stop at first failing trial
  }
  const pass = trials.length === k && trials.every((t) => t.pass);
  return { id: gt.id, scenario: gt.scenario, ciBlocking: !!gt.ciBlocking, k, pass, trials };
}

function runL2() {
  const files = existsSync(GOLDEN_DIR) ? readdirSync(GOLDEN_DIR).filter((f) => f.endsWith(".json")).sort() : [];
  const results = files.map((f) => runGoldenTask(JSON.parse(readFileSync(resolve(GOLDEN_DIR, f), "utf8"))));
  const ciBlocking = results.filter((r) => r.ciBlocking);
  const ciPass = ciBlocking.every((r) => r.pass);
  const allPass = results.every((r) => r.pass);
  return { level: 2, pass: ciPass, allPass, results };
}

// ---------- L3 ----------
async function runL3() {
  const { calibrate } = await import(pathToFileURL(L3_JUDGE).href);
  const r = calibrate();
  return { level: 3, pass: r.pass, calibration: r };
}

// ---------- main ----------
async function main() {
  const { level, json } = parseArgs(process.argv.slice(2));
  if (!existsSync(CLI)) {
    console.error(`eval: CLI not built at ${CLI} — run \`pnpm build\` first.`);
    process.exit(2);
  }

  const out = { levels: {} };
  let overallPass = true;

  if (level === 0 || level === 1) {
    const r1 = runL1();
    out.levels.L1 = r1;
    overallPass = overallPass && r1.pass;
  }
  if (level === 0 || level === 2) {
    const r2 = runL2();
    out.levels.L2 = r2;
    overallPass = overallPass && r2.pass;
    if (!json) {
      console.log(`\nL2 golden tasks (${r2.results.length}) — CI-blocking must pass^${PASS_K}:`);
      for (const r of r2.results) {
        const tag = r.ciBlocking ? `[CI-block, pass^${r.k}]` : "";
        console.log(`  ${r.pass ? "✓" : "✗"} ${r.id} (${r.scenario}) ${tag}`);
        if (!r.pass) {
          const failing = r.trials.flatMap((t) => t.checks.filter((c) => !c.pass));
          for (const c of failing) console.log(`      - ${c.name}: ${c.detail}`);
        }
      }
    }
  }
  if (level === 0 || level === 3) {
    const r3 = await runL3();
    out.levels.L3 = r3;
    overallPass = overallPass && r3.pass;
    if (!json) {
      const c = r3.calibration;
      console.log(`\nL3 judge calibration: F1=${c.f1} kappa=${c.kappa} over ${c.trajectories} trajectories → ${r3.pass ? "CALIBRATED ✓" : "NOT calibrated ✗"}`);
    }
  }

  out.pass = overallPass;
  if (json) {
    process.stdout.write(JSON.stringify(out, null, 2) + "\n");
  } else {
    console.log(`\n${overallPass ? "✓ eval PASSED" : "✗ eval FAILED"} (${level === 0 ? "all levels" : "L" + level})`);
  }
  process.exit(overallPass ? 0 : 1);
}

main().catch((e) => {
  console.error("eval runner error:", e instanceof Error ? e.message : e);
  process.exit(2);
});
