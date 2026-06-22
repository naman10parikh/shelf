#!/usr/bin/env node
// l3-judge.mjs — Hamel Level 3: a CALIBRATED rubric judge for trajectory tasks (migration no-drift /
// WORM-routing / async-scan-design). NOT a raw 1-5 Likert opinion (the 🟡 the overrides reject) — a
// DETERMINISTIC rubric scorer that is itself CALIBRATED against a hand-labeled trajectory set.
//
// How it works:
//   1. The judge() function scores a candidate answer pass/fail by the scenario's rubric: every
//      rubricKeyword present AND no antiKeyword present (lowercased substring match — the objective
//      "Eval check" made executable, the dsip noSelfGrading rule).
//   2. We run that SAME judge over eval/labels/trajectory-labels.json (>=10 hand-labeled trajectories)
//      and measure AGREEMENT vs the gold labels: accuracy, precision/recall/F1, and Cohen's kappa.
//   3. The gate is kappa>=0.6 AND F1>=0.8 (Hamel: a judge you can trust). If the judge can't agree with
//      humans on the calibration set, it is not fit to grade live trajectories — exit non-zero.
//
// This is what "L3 judge calibrated, not Likert" means concretely: the judge is graded before it grades.
// $0, tokenless, deterministic — the Claude-half (free-text trajectory generation) is deferred (D8).

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const LABELS = resolve(REPO_ROOT, "eval", "labels", "trajectory-labels.json");

/**
 * The rubric judge. Returns "pass" iff every rubricKeyword appears in the candidate (lowercased) AND no
 * antiKeyword appears. This is the objective rubric — the scenario's "Eval check" turned into a check.
 */
export function judge(candidate, rubricKeywords = [], antiKeywords = []) {
  const text = String(candidate).toLowerCase();
  const allRubricPresent = rubricKeywords.every((k) => text.includes(String(k).toLowerCase()));
  const anyAntiPresent = antiKeywords.some((k) => text.includes(String(k).toLowerCase()));
  return allRubricPresent && !anyAntiPresent ? "pass" : "fail";
}

/** Cohen's kappa for two binary raters over the same items. */
function cohenKappa(a, b) {
  const n = a.length;
  if (n === 0) return 0;
  let agree = 0;
  let aPass = 0;
  let bPass = 0;
  for (let i = 0; i < n; i++) {
    if (a[i] === b[i]) agree += 1;
    if (a[i] === "pass") aPass += 1;
    if (b[i] === "pass") bPass += 1;
  }
  const po = agree / n;
  // Expected agreement by chance: P(both pass) + P(both fail).
  const pe = (aPass / n) * (bPass / n) + (1 - aPass / n) * (1 - bPass / n);
  if (pe === 1) return 1; // degenerate (all same class) → treat as perfect agreement
  return (po - pe) / (1 - pe);
}

function prf1(gold, pred) {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  for (let i = 0; i < gold.length; i++) {
    const g = gold[i] === "pass";
    const p = pred[i] === "pass";
    if (g && p) tp += 1;
    else if (!g && p) fp += 1;
    else if (g && !p) fn += 1;
  }
  const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 1 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { precision, recall, f1, tp, fp, fn };
}

function round(n) {
  return Math.round(n * 1000) / 1000;
}

export function calibrate() {
  const data = JSON.parse(readFileSync(LABELS, "utf8"));
  const minKappa = data.gate?.minKappa ?? 0.6;
  const minF1 = data.gate?.minF1 ?? 0.8;
  const trajectories = data.trajectories ?? [];

  const gold = [];
  const pred = [];
  const perItem = [];
  for (const t of trajectories) {
    const g = t.label; // hand label
    const p = judge(t.candidate, t.rubricKeywords ?? [], t.antiKeywords ?? []);
    gold.push(g);
    pred.push(p);
    perItem.push({ id: t.id, scenario: t.scenario, gold: g, judged: p, agree: g === p });
  }

  const n = gold.length;
  const correct = perItem.filter((x) => x.agree).length;
  const accuracy = n === 0 ? 0 : correct / n;
  const kappa = cohenKappa(gold, pred);
  const { precision, recall, f1 } = prf1(gold, pred);
  const pass = n >= 10 && kappa >= minKappa && f1 >= minF1;

  return {
    level: "L3",
    trajectories: n,
    accuracy: round(accuracy),
    precision: round(precision),
    recall: round(recall),
    f1: round(f1),
    kappa: round(kappa),
    gate: { minKappa, minF1, minTrajectories: 10 },
    pass,
    perItem,
  };
}

// CLI entry.
if (import.meta.url === `file://${process.argv[1]}`) {
  const jsonMode = process.argv.includes("--json");
  const r = calibrate();
  if (jsonMode) {
    process.stdout.write(JSON.stringify(r, null, 2) + "\n");
  } else {
    console.log(`L3 judge calibration over ${r.trajectories} hand-labeled trajectories:`);
    console.log(`  accuracy=${r.accuracy}  precision=${r.precision}  recall=${r.recall}  F1=${r.f1}  kappa=${r.kappa}`);
    console.log(`  gate: kappa>=${r.gate.minKappa} AND F1>=${r.gate.minF1} AND trajectories>=${r.gate.minTrajectories}`);
    for (const x of r.perItem.filter((i) => !i.agree)) {
      console.log(`  ✗ disagree on ${x.id} (${x.scenario}): gold=${x.gold} judged=${x.judged}`);
    }
    console.log(r.pass ? "✓ L3 judge is CALIBRATED (trustworthy on live trajectories)" : "✗ L3 judge NOT calibrated — do not trust it to grade trajectories");
  }
  process.exit(r.pass ? 0 : 1);
}
