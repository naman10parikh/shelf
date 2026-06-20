#!/usr/bin/env node
// shelf — the Energy fleet's object-storage / file-handling / CDN / uploads employee.
//
// The hands: presign (POST policy > PUT), upload (validate → presign → upload → HEAD re-validate), get,
// validate (magic bytes + resource-consumption caps + SVG refusal), lifecycle, cost, backend pick,
// migrate, scan, serve-config, cors, brain (BM25 over brain/), explain, eval.
//
// Creed: don't trust the client · make things immutable · CDN in front of every hot byte · store the
// pointer in the DB and the bytes in object storage · pick the provider per-workload, not per-tribe.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import chalk from "chalk";
import { setJsonMode, ShelfError } from "./lib/output.js";

import { registerPresign } from "./commands/presign.js";
import { registerUpload } from "./commands/upload.js";
import { registerGet } from "./commands/get.js";
import { registerValidate } from "./commands/validate.js";
import { registerBrain } from "./commands/brain.js";
import { registerLifecycle } from "./commands/lifecycle.js";
import { registerCost } from "./commands/cost.js";
import { registerBackend } from "./commands/backend.js";
import { registerMigrate } from "./commands/migrate.js";
import { registerScan } from "./commands/scan.js";
import { registerServeConfig } from "./commands/serve-config.js";
import { registerCors } from "./commands/cors.js";
import { registerExplain } from "./commands/explain.js";
import { registerEval } from "./commands/eval.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function readVersion(): string {
  try {
    const pkgPath = resolve(__dirname, "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

const program = new Command();

program
  .name("shelf")
  .description(
    "object-storage / file-handling / CDN / uploads employee — presigned POST > PUT, magic-byte " +
      "validation, abort-incomplete-multipart day-one, egress-first cost. Powered by Energy.",
  )
  .version(readVersion(), "-v, --version", "print the shelf version")
  .option("--json", "emit machine-readable JSON (on data commands)", false)
  .hook("preAction", (thisCommand) => {
    // The --json flag is global; flip the shared output mode before any action runs.
    const opts = thisCommand.opts<{ json?: boolean }>();
    setJsonMode(Boolean(opts.json));
  });

// Acceptance-path commands (B2) — the bar.
registerPresign(program);
registerUpload(program);
registerGet(program);
registerValidate(program);
registerBrain(program);

// Expertise commands (B3).
registerLifecycle(program);
registerCost(program);
registerBackend(program);
registerMigrate(program);
registerScan(program);
registerServeConfig(program);
registerCors(program);
registerExplain(program);
registerEval(program);

async function main(): Promise<void> {
  // commander v12 supports async action handlers via parseAsync.
  await program.parseAsync(process.argv);
}

main().catch((err: unknown) => {
  if (err instanceof ShelfError) {
    process.stderr.write(chalk.red(`✗ ${err.message}`) + "\n");
    process.exitCode = 1;
    return;
  }
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(chalk.red(`✗ ${message}`) + "\n");
  process.exitCode = 1;
});
