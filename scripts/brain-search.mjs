#!/usr/bin/env node
// brain-search.mjs — BM25 search over shelf's expertise brain (brain/*.md).
//
// The Memory component's queryable layer. scripts/memory-search.sh indexes memory/ (LEARNINGS/daily/
// topics) — it does NOT index brain/. This is a real BM25 index over the six Wave-R brain artifacts,
// chunked by markdown heading, returning RANKED hits with the file + the matched node ID (S-/P-/O-/
// JTBD-/Dispute/V-). The `shelf brain <query>` CLI (B2) wraps this engine.
//
// Usage:  node scripts/brain-search.mjs "presigned PUT size limit" [--limit N] [--json] [--dir <path>]
//
// BM25 params: k1=1.5, b=0.75 (standard). Zero runtime deps (Node stdlib only) — cold-runnable.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_BRAIN_DIR = resolve(__dirname, "..", "brain");

// ---- arg parsing -----------------------------------------------------------
const args = process.argv.slice(2);
let query = "";
let limit = 5;
let asJson = false;
let brainDir = DEFAULT_BRAIN_DIR;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--limit") limit = parseInt(args[++i], 10) || 5;
  else if (a === "--json") asJson = true;
  else if (a === "--dir") brainDir = resolve(args[++i]);
  else if (a === "--help" || a === "-h") {
    process.stdout.write(
      "Usage: brain-search.mjs \"query\" [--limit N] [--json] [--dir <path>]\n" +
        "BM25 ranked search over shelf's expertise brain (brain/*.md).\n",
    );
    process.exit(0);
  } else if (!query) query = a;
  else query += " " + a;
}

if (!query.trim()) {
  process.stderr.write('Error: no query provided. Usage: brain-search.mjs "query"\n');
  process.exit(1);
}

// ---- tokenization ----------------------------------------------------------
// Lowercase, split on non-alphanumeric, drop very short tokens and stopwords.
const STOP = new Set([
  "the", "a", "an", "to", "of", "in", "on", "is", "are", "for", "and", "or",
  "it", "this", "that", "be", "as", "at", "by", "with", "from", "your", "you",
]);
function tokenize(s) {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2 && !STOP.has(t));
}

// ---- node-ID extraction from a heading -------------------------------------
// Turns a markdown heading into a canonical brain node ID where one exists.
//   "### P-01 — Presigned PUT ..."            -> "P-01"
//   "### O-14 — Treat presigned URLs ..."     -> "O-14"
//   "## SCENARIO 6 — \"I set a 1 MB limit\""  -> "S6"   (synthesized: SCENARIO N -> SN)
//   "## JTBD 1 — Choose the right ..."        -> "JTBD-1"
//   "### V-04 ..."                            -> "V-04"
//   "### Dispute A — ..."                     -> "Dispute A"
function nodeIdFor(heading) {
  if (!heading) return "";
  const h = heading.replace(/^#+\s*/, "").trim();
  let m;
  if ((m = h.match(/\b([POV]-\d+)\b/))) return m[1]; // P-01 / O-14 / V-04
  if ((m = h.match(/\bSCENARIO\s+(\d+)/i))) return "S" + m[1]; // SCENARIO 6 -> S6
  if ((m = h.match(/\bJTBD[\s-]*(\d+)/i))) return "JTBD-" + m[1];
  if ((m = h.match(/\bDispute\s+([A-Z])\b/))) return "Dispute " + m[1];
  return "";
}

// ---- chunking: split a markdown file by heading ----------------------------
function chunkMarkdown(text, file) {
  const lines = text.split("\n");
  const chunks = [];
  let curHeading = "(preamble)";
  let curBody = [];
  const flush = () => {
    const body = curBody.join("\n").trim();
    if (body || curHeading !== "(preamble)") {
      chunks.push({
        file,
        heading: curHeading,
        nodeId: nodeIdFor(curHeading),
        text: curHeading + "\n" + body,
      });
    }
    curBody = [];
  };
  let inFrontmatter = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // skip YAML frontmatter (--- ... ---) at the very top
    if (i === 0 && line.trim() === "---") { inFrontmatter = true; continue; }
    if (inFrontmatter) { if (line.trim() === "---") inFrontmatter = false; continue; }
    if (/^#{1,6}\s+/.test(line)) {
      flush();
      curHeading = line.trim();
    } else {
      curBody.push(line);
    }
  }
  flush();
  return chunks;
}

// ---- load + chunk all brain files ------------------------------------------
let files;
try {
  files = readdirSync(brainDir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => join(brainDir, f))
    .filter((p) => statSync(p).isFile());
} catch (err) {
  process.stderr.write(`Error: cannot read brain dir ${brainDir}: ${err.message}\n`);
  process.exit(1);
}

const docs = []; // { file, heading, nodeId, text, tokens, len }
for (const path of files) {
  const text = readFileSync(path, "utf8");
  const rel = "brain/" + basename(path);
  for (const ch of chunkMarkdown(text, rel)) {
    const tokens = tokenize(ch.text);
    if (tokens.length === 0) continue;
    docs.push({ ...ch, tokens, len: tokens.length });
  }
}

if (docs.length === 0) {
  process.stderr.write(`Error: no indexable content in ${brainDir}\n`);
  process.exit(1);
}

// ---- BM25 ------------------------------------------------------------------
const N = docs.length;
const avgdl = docs.reduce((s, d) => s + d.len, 0) / N;
const k1 = 1.5;
const b = 0.75;

// document frequency per term
const df = new Map();
for (const d of docs) {
  const seen = new Set(d.tokens);
  for (const t of seen) df.set(t, (df.get(t) || 0) + 1);
}
function idf(term) {
  const n = df.get(term) || 0;
  // BM25 idf with +1 to stay non-negative
  return Math.log(1 + (N - n + 0.5) / (n + 0.5));
}

const qTerms = tokenize(query);
const qSet = [...new Set(qTerms)];

// term frequency per doc (computed lazily for query terms only)
function bm25Score(doc) {
  const tf = new Map();
  for (const t of doc.tokens) if (qSet.includes(t)) tf.set(t, (tf.get(t) || 0) + 1);
  let score = 0;
  for (const t of qSet) {
    const f = tf.get(t) || 0;
    if (f === 0) continue;
    const num = f * (k1 + 1);
    const den = f + k1 * (1 - b + b * (doc.len / avgdl));
    score += idf(t) * (num / den);
  }
  return score;
}

const ranked = docs
  .map((d) => ({ ...d, score: bm25Score(d) }))
  .filter((d) => d.score > 0)
  .sort((a, b) => b.score - a.score)
  .slice(0, limit);

// ---- output ----------------------------------------------------------------
if (asJson) {
  process.stdout.write(
    JSON.stringify(
      {
        query,
        results: ranked.map((d, i) => ({
          rank: i + 1,
          score: Number(d.score.toFixed(4)),
          file: d.file,
          node: d.nodeId || null,
          heading: d.heading.replace(/^#+\s*/, ""),
        })),
      },
      null,
      2,
    ) + "\n",
  );
} else {
  if (ranked.length === 0) {
    process.stdout.write(`No brain hits for: ${query}\n`);
    process.exit(0);
  }
  process.stdout.write(`=== brain search: "${query}" ===\n\n`);
  ranked.forEach((d, i) => {
    const node = d.nodeId ? ` [node: ${d.nodeId}]` : "";
    const head = d.heading.replace(/^#+\s*/, "");
    process.stdout.write(
      `[${i + 1}] score ${d.score.toFixed(3)}  ${d.file}${node}\n     §${head}\n\n`,
    );
  });
}
