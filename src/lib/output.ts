// output.ts — shared output helpers so every command renders consistently in --json vs human mode.
//
// Data commands emit Zod-validated JSON on --json (machine surface for agents / the cockpit) and a
// readable summary otherwise. A non-zero exit is signalled by fail(); we let the caller decide the code
// (commander actions throw; index.ts maps the throw to process.exitCode).

import chalk from "chalk";

/** Set by the root --json global flag. Read by emit()/note(). */
let jsonMode = false;

export function setJsonMode(on: boolean): void {
  jsonMode = on;
}

export function isJsonMode(): boolean {
  return jsonMode;
}

/**
 * Emit a successful data payload. In --json mode prints the object as JSON; otherwise prints `human`
 * (a pre-formatted string) if given, else a compact key: value dump.
 *
 * `payload` is `unknown` (not `Record<string, unknown>`) so typed-interface results from the shared libs
 * (cost.estimateCost → CostEstimate, recommendations.pickBackend → BackendRec, …) pass without an `as`
 * cast — a TS interface does not satisfy the Record index signature, but emit only stringifies or
 * Object.entries() the value, both of which are safe here.
 */
export function emit(payload: unknown, human?: string): void {
  if (jsonMode) {
    process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
    return;
  }
  if (human !== undefined) {
    process.stdout.write(human + "\n");
    return;
  }
  if (payload !== null && typeof payload === "object") {
    for (const [k, v] of Object.entries(payload)) {
      process.stdout.write(`${chalk.dim(k + ":")} ${typeof v === "object" ? JSON.stringify(v) : String(v)}\n`);
    }
    return;
  }
  process.stdout.write(String(payload) + "\n");
}

/** A non-fatal advisory line (the opinionated warnings shelf prints — e.g. the PUT-can't-bound-size caveat). */
export function note(message: string): void {
  if (jsonMode) return; // warnings ride inside the JSON payload's `warnings` array, not stderr noise
  process.stderr.write(chalk.yellow("⚠ ") + message + "\n");
}

/** A thrown command failure. index.ts catches it, prints, and sets exit code 1. */
export class ShelfError extends Error {
  readonly code: string;
  constructor(message: string, code = "SHELF_ERROR") {
    super(message);
    this.name = "ShelfError";
    this.code = code;
  }
}

/** Throw a ShelfError (non-zero exit). Use for validation rejects, missing creds, etc. */
export function fail(message: string, code?: string): never {
  throw new ShelfError(message, code);
}

/**
 * Normalize any thrown value at a command boundary: ShelfErrors propagate unchanged (their message is
 * already user-facing); any other error becomes a ShelfError so index.ts renders it and exits 1. In JSON
 * mode an {ok:false,error} object is also emitted so machine callers see the failure.
 */
export function failFrom(err: unknown): never {
  if (err instanceof ShelfError) throw err;
  const message = err instanceof Error ? err.message : String(err);
  if (jsonMode) process.stdout.write(JSON.stringify({ ok: false, error: message }, null, 2) + "\n");
  throw new ShelfError(message);
}
