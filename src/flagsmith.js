// Flagsmith access for FlagPilot.
//
// Live mode in this workspace goes through the verified Flagsmith helper
// (~/workspace/custom-connectors/custom.flagsmith/bin/flagsmith.py), which
// talks to the Management API with the stored credential. FlagPilot never
// sees or prints the credential: it only parses the helper's JSON output.
// Dry-run mode records the plan steps that WOULD run and makes no calls.

import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export class FlagsmithError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export function defaultHelperPath() {
  return (
    process.env.FLAGSMITH_HELPER_PATH ??
    join(homedir(), "workspace/custom-connectors/custom.flagsmith/bin/flagsmith.py")
  );
}

export function createDryRunClient() {
  const requests = [];
  return {
    mode: "dry-run",
    dryRun: true,
    requests,
    recordStep(step) {
      const entry = { method: step.method, path: step.path, body: step.body ?? null };
      requests.push(entry);
      return { dryRun: true, ...entry };
    },
  };
}

export function createHelperClient({
  python = process.env.FLAGPILOT_PYTHON ?? "python3",
  helperPath = defaultHelperPath(),
  runner = null,
} = {}) {
  async function run(command) {
    if (runner) return runner(command);
    let stdout;
    try {
      ({ stdout } = await execFileAsync(python, [helperPath, command], {
        timeout: 120000,
        maxBuffer: 4 * 1024 * 1024,
      }));
    } catch (err) {
      const detail = String(err.stderr ?? err.message ?? "helper failed").slice(0, 1000);
      throw new FlagsmithError(`Flagsmith helper '${command}' failed: ${detail}`);
    }
    try {
      return JSON.parse(stdout);
    } catch {
      throw new FlagsmithError(`Flagsmith helper '${command}' returned non-JSON output`);
    }
  }

  return {
    mode: "live",
    dryRun: false,
    helperPath,
    status: () => run("status"),
    readState: () => run("gate1-read"),
    // Idempotent ensure: creates only missing warehouse/flag/metric/
    // experiment pieces and starts the experiment only if not running.
    ensureExperiment: () => run("gate1-run"),
  };
}

export function createClient({ dryRun = false, ...rest } = {}) {
  return dryRun ? createDryRunClient() : createHelperClient(rest);
}
