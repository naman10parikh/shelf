// brain.ts (lib) — shared brain access for the MCP tools `search_brain` + `explain_pitfall`.
//
// The BM25 engine lives in scripts/brain-search.mjs (A4 — the Memory component's queryable layer). The CLI
// `shelf brain`/`shelf explain` shell out to it; the MCP tools reuse the SAME engine + section-extraction
// here so the two surfaces never diverge. Section extraction mirrors src/commands/explain.ts (heading-id
// match + collect-body-until-next-heading).

import { readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// dist/lib/brain.js → repo root is two levels up; src/lib too.
const REPO_ROOT = resolve(__dirname, "..", "..");
const BRAIN_DIR = resolve(REPO_ROOT, "brain");
const ENGINE = resolve(REPO_ROOT, "scripts", "brain-search.mjs");

// Heading-id patterns: S6, P-01, O-14, V-12, JTBD-3, Dispute A (mirrors src/commands/explain.ts).
const ID_PATTERNS = [/^S\d+$/i, /^P-\d+$/i, /^O-\d+$/i, /^V-\d+$/i, /^JTBD-\d+$/i, /^Dispute\s+[A-Z]$/i];

export interface BrainHit {
  rank: number;
  score: number;
  file: string;
  node: string;
  heading: string;
}

export interface BrainSection {
  file: string;
  heading: string;
  body: string;
}

/** Run a BM25 search over brain/ via the A4 engine. Throws if the engine fails (the MCP maps to isError). */
export function searchBrain(query: string, limit = 5): BrainHit[] {
  const proc = spawnSync("node", [ENGINE, query, "--limit", String(limit), "--json"], { encoding: "utf8" });
  if (proc.status !== 0) {
    throw new Error(`brain search failed: ${proc.stderr?.trim() || `engine exited ${proc.status}`}`);
  }
  const parsed = JSON.parse(proc.stdout) as { results: BrainHit[] };
  return parsed.results;
}

/**
 * Explain a named node id (S-/P-/O-/V-/JTBD-/Dispute) by extracting that exact section, or fall back to a
 * BM25 top-hit for a free-text topic. Returns the section (with body) plus alternatives for free-text.
 */
export function explain(idOrTopic: string): { matched: string; section: BrainSection | null; alternatives: BrainHit[] } {
  const query = idOrTopic.trim();
  if (ID_PATTERNS.some((re) => re.test(query))) {
    const section = findSection(query);
    if (section) return { matched: query, section, alternatives: [] };
    // Known-id shape but not found — fall through to search so we still teach something.
  }
  const hits = searchBrain(query, 3);
  const top = hits[0];
  if (!top) return { matched: query, section: null, alternatives: [] };
  return { matched: top.node, section: findSectionByHeading(top.file, top.heading), alternatives: hits.slice(1) };
}

/** Find a section whose heading corresponds to the id (e.g. "P-01" / "S6" / "Dispute A"). */
function findSection(id: string): BrainSection | null {
  for (const file of brainFiles()) {
    const text = readFileSync(join(BRAIN_DIR, file), "utf8");
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const m = (lines[i] ?? "").match(/^#{2,4}\s+(.*)$/);
      if (m && headingMatchesId(m[1] ?? "", id)) {
        return { file: `brain/${file}`, heading: m[1] ?? "", body: collectBody(lines, i) };
      }
    }
  }
  return null;
}

function findSectionByHeading(fileRel: string, heading: string): BrainSection | null {
  const file = fileRel.replace(/^brain\//, "");
  try {
    const text = readFileSync(join(BRAIN_DIR, file), "utf8");
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const m = (lines[i] ?? "").match(/^#{2,4}\s+(.*)$/);
      if (m && (m[1] ?? "").trim() === heading.trim()) {
        return { file: fileRel, heading, body: collectBody(lines, i) };
      }
    }
  } catch {
    return null;
  }
  return null;
}

function headingMatchesId(heading: string, id: string): boolean {
  const normId = id.toUpperCase();
  const h = heading.toUpperCase();
  if (normId.startsWith("DISPUTE")) return h.startsWith(normId);
  if (/^S\d+$/.test(normId)) return new RegExp(`^SCENARIO\\s+${normId.slice(1)}\\b`).test(h);
  return h.startsWith(normId + " ") || h.startsWith(normId + " —") || h.startsWith(normId + "—");
}

function collectBody(lines: string[], headingIndex: number): string {
  const headingLine = lines[headingIndex] ?? "";
  const level = (headingLine.match(/^#+/)?.[0] ?? "##").length;
  const out: string[] = [];
  for (let i = headingIndex + 1; i < lines.length; i++) {
    const m = (lines[i] ?? "").match(/^(#+)\s/);
    if (m && (m[1]?.length ?? 99) <= level) break;
    out.push(lines[i] ?? "");
  }
  return out.join("\n").trim();
}

function brainFiles(): string[] {
  try {
    return readdirSync(BRAIN_DIR).filter((f) => f.endsWith(".md"));
  } catch {
    return [];
  }
}
