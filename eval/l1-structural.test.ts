// l1-structural.test.ts — Hamel Level 1 (structural assertions). The cheapest, most deterministic gate:
// does the harness have the right SHAPE? No network, no backend, $0. Vitest, red-blocking (PLAN §9).
//
// L1 answers: is the CLI built and runnable? does it expose every command in the §4 tree? do the golden
// tasks map to >=10 distinct brain S-IDs with the CI-blocking set tagged? do the acceptance fixtures exist?
// L2 (behavioral) lives in eval/run.mjs; L3 (judge calibration) in eval/l3-judge.mjs.

import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const CLI = resolve(REPO_ROOT, "dist", "index.js");
const GOLDEN_DIR = resolve(REPO_ROOT, "eval", "golden");

/** Run the built CLI and capture stdout (throws on non-zero unless allowFail). */
function cli(args: string[], allowFail = false): { stdout: string; status: number } {
  try {
    const stdout = execFileSync("node", [CLI, ...args], { encoding: "utf8" });
    return { stdout, status: 0 };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; status?: number };
    if (!allowFail) throw e;
    return { stdout: (err.stdout ?? "") + (err.stderr ?? ""), status: err.status ?? 1 };
  }
}

const EXPECTED_COMMANDS = [
  "presign",
  "upload",
  "get",
  "validate",
  "lifecycle",
  "cost",
  "backend",
  "migrate",
  "scan",
  "serve-config",
  "cors",
  "brain",
  "explain",
  "eval",
];

const CI_BLOCKING = ["GT-1", "GT-2", "GT-3", "GT-4", "GT-6", "GT-13"];

describe("L1 — CLI is built and runnable", () => {
  beforeAll(() => {
    if (!existsSync(CLI)) {
      throw new Error(`CLI not built at ${CLI} — run \`pnpm build\` first (L1 asserts the built artifact).`);
    }
  });

  it("`shelf --version` exits 0 and prints a semver", () => {
    const { stdout } = cli(["--version"]);
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("`shelf --help` lists every command in the §4 tree", () => {
    const { stdout } = cli(["--help"]);
    for (const cmd of EXPECTED_COMMANDS) {
      expect(stdout, `--help is missing command: ${cmd}`).toContain(cmd);
    }
  });
});

describe("L1 — golden tasks are well-formed and map to brain S-IDs", () => {
  const files = existsSync(GOLDEN_DIR) ? readdirSync(GOLDEN_DIR).filter((f) => f.endsWith(".json")) : [];

  it("has >=10 golden task files (GT-1..GT-14)", () => {
    expect(files.length).toBeGreaterThanOrEqual(10);
  });

  it("every golden task declares an id, a brain scenario, a level, and >=1 check", () => {
    for (const f of files) {
      const gt = JSON.parse(readFileSync(resolve(GOLDEN_DIR, f), "utf8")) as {
        id: string;
        scenario: string;
        level: string[];
        checks: unknown[];
      };
      expect(gt.id, `${f} missing id`).toMatch(/^GT-\d+$/);
      expect(gt.scenario, `${f} missing scenario`).toBeTruthy();
      expect(Array.isArray(gt.level) && gt.level.length > 0, `${f} missing level`).toBe(true);
      expect(Array.isArray(gt.checks) && gt.checks.length > 0, `${f} has no checks`).toBe(true);
    }
  });

  it("maps to >=10 DISTINCT brain S-IDs (the Memory→eval traceability)", () => {
    const sids = new Set<string>();
    for (const f of files) {
      const gt = JSON.parse(readFileSync(resolve(GOLDEN_DIR, f), "utf8")) as { scenario: string };
      const m = gt.scenario.match(/S\d+/);
      if (m) sids.add(m[0]);
    }
    expect(sids.size, `only ${sids.size} distinct S-IDs: ${[...sids].join(",")}`).toBeGreaterThanOrEqual(10);
  });

  it("tags the CI-blocking set (GT-1/2/3/4/6/13) with ciBlocking:true", () => {
    const blocking = new Set<string>();
    for (const f of files) {
      const gt = JSON.parse(readFileSync(resolve(GOLDEN_DIR, f), "utf8")) as { id: string; ciBlocking?: boolean };
      if (gt.ciBlocking === true) blocking.add(gt.id);
    }
    for (const id of CI_BLOCKING) {
      expect(blocking.has(id), `CI-blocking task ${id} is not tagged ciBlocking:true`).toBe(true);
    }
  });
});

describe("L1 — acceptance fixtures exist (the round-trip + the three rejects)", () => {
  const FIXTURES = resolve(REPO_ROOT, "eval", "fixtures");
  for (const f of ["hello.png", "too-big.bin", "fake.png", "evil.svg"]) {
    it(`fixture exists: ${f}`, () => {
      expect(existsSync(resolve(FIXTURES, f)), `missing fixture eval/fixtures/${f}`).toBe(true);
    });
  }
});
