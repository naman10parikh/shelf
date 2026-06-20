// explain.ts — `shelf explain <S-id|P-id|O-id|Dispute X|V-id|topic>` — the teaching surface.
//
// For a known node id, extract that exact section from the brain markdown and print it. For a free-text
// topic, fall back to BM25 (the brain engine) and point at the top hit. This is how an agent (or the
// cockpit's ask-the-employee box) gets the WHY behind a stance/pitfall/scenario.

import type { Command } from "commander";
import { readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { emit, failFrom, isJsonMode } from "../lib/output.js";
import { withRun } from "../lib/observability.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
const BRAIN_DIR = resolve(REPO_ROOT, "brain");
const ENGINE = resolve(REPO_ROOT, "scripts", "brain-search.mjs");

// Heading-id patterns: S6, P-01, O-14, V-12, JTBD-3, Dispute A.
const ID_PATTERNS = [/^S\d+$/i, /^P-\d+$/i, /^O-\d+$/i, /^V-\d+$/i, /^JTBD-\d+$/i, /^Dispute\s+[A-Z]$/i];

export function registerExplain(program: Command): void {
  program
    .command("explain <id...>")
    .description("explain a named scenario/pitfall/opinion (S-/P-/O-/Dispute/V- id) or a free-text topic")
    .action(async (idParts: string[]) => {
      const query = idParts.join(" ").trim();
      await withRun("explain", [query], async () => {
        if (ID_PATTERNS.some((re) => re.test(query))) {
          const section = findSection(query);
          if (section) {
            emit({ id: query, file: section.file, heading: section.heading, body: section.body }, `# ${section.heading}\n(${section.file})\n\n${section.body}`);
            return;
          }
          // Known-id shape but not found — fall through to search so we still teach something.
        }
        // Free-text (or unmatched id) → BM25 top hits.
        const proc = spawnSync("node", [ENGINE, query, "--limit", "3", "--json"], { encoding: "utf8" });
        const parsed = proc.status === 0 ? (JSON.parse(proc.stdout) as { results: Array<{ node: string; file: string; heading: string }> }) : { results: [] };
        const top = parsed.results[0];
        if (top) {
          const section = findSectionByHeading(top.file, top.heading);
          emit(
            { query, matched: top.node, file: top.file, heading: top.heading, body: section?.body ?? null, alternatives: parsed.results.slice(1) },
            `closest match: ${top.node} — ${top.heading}\n(${top.file})\n\n${section?.body ?? "(see file)"}`,
          );
          return;
        }
        emit({ query, results: [] }, isJsonMode() ? "" : `no brain entry found for "${query}". Try an S-/P-/O- id or a topic like "presigned size limit".`);
      }).catch(failFrom);
    });
}

interface Section {
  file: string;
  heading: string;
  body: string;
}

/** Find a section whose heading STARTS WITH the id (e.g. "P-01" matches "### P-01 — ..."). */
function findSection(id: string): Section | null {
  for (const file of brainFiles()) {
    const full = join(BRAIN_DIR, file);
    const text = readFileSync(full, "utf8");
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      const m = line.match(/^#{2,4}\s+(.*)$/);
      if (m && headingMatchesId(m[1] ?? "", id)) {
        return { file: `brain/${file}`, heading: m[1] ?? "", body: collectBody(lines, i) };
      }
    }
  }
  return null;
}

function findSectionByHeading(fileRel: string, heading: string): Section | null {
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

/** Does a heading line correspond to the requested node id? */
function headingMatchesId(heading: string, id: string): boolean {
  const normId = id.toUpperCase();
  const h = heading.toUpperCase();
  if (normId.startsWith("DISPUTE")) return h.startsWith(normId);
  // "P-01 — ..." / "SCENARIO 6 — ..." (S6) / "O-14 — ..." / "V-12 ..."
  if (/^S\d+$/.test(normId)) return new RegExp(`^SCENARIO\\s+${normId.slice(1)}\\b`).test(h);
  return h.startsWith(normId + " ") || h.startsWith(normId + " —") || h.startsWith(normId + "—");
}

/** Collect lines until the next heading of the same-or-higher level. */
function collectBody(lines: string[], headingIndex: number): string {
  const headingLine = lines[headingIndex] ?? "";
  const level = (headingLine.match(/^#+/)?.[0] ?? "##").length;
  const out: string[] = [];
  for (let i = headingIndex + 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const m = line.match(/^(#+)\s/);
    if (m && (m[1]?.length ?? 99) <= level) break;
    out.push(line);
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
