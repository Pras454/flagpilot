#!/usr/bin/env node
// FlagPilot CLI:
//   plan                 render the plan (no writes)
//   execute              dry-run by default (records steps, no network)
//   execute --live       live via the Flagsmith helper; requires approval
//   status               live read-only status through the helper
//   simulate             deterministic local results simulation (no events)
//   demo                 plan + dry-run + simulation, end to end

import { createInterface } from "node:readline/promises";

import { buildPlan } from "./planner.js";
import { renderPlan } from "./approval.js";
import { createClient, createHelperClient } from "./flagsmith.js";
import { executePlan, summarizeState } from "./executor.js";
import { simulateResults, formatSimulation } from "./simulator.js";
import { formatLiveStatus, formatExecution } from "./reporter.js";

const DEMO_INPUT = {
  organisationId: 42351,
  projectId: 56691,
  environmentName: "Development",
  flagName: "checkout_button",
  controlValue: "Buy now",
  variations: [{ key: "v_get_yours", value: "Get yours", percentageAllocation: 50 }],
  successEvent: "purchase",
  metricName: "purchase",
  experimentName: "Checkout button copy",
  hypothesis: "'Get yours' lifts purchases vs 'Buy now'",
  rolloutPercentage: 100,
};

function optionValue(args, name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback;
}

async function confirmLive(plan, args) {
  console.log(renderPlan(plan));
  if (args.includes("--yes")) return { planId: plan.planId, confirm: true };
  if (!process.stdin.isTTY) {
    throw new Error("live execution needs approval: re-run with --yes after reviewing the plan");
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question("Approve this plan? [y/N] ");
    return { planId: plan.planId, confirm: /^y(es)?$/i.test(answer.trim()) };
  } finally {
    rl.close();
  }
}

async function main(argv) {
  const [command, ...rest] = argv;

  if (command === "plan") {
    console.log(renderPlan(buildPlan(DEMO_INPUT)));
    return;
  }

  if (command === "execute") {
    const plan = buildPlan(DEMO_INPUT);
    if (rest.includes("--live")) {
      const approval = await confirmLive(plan, rest);
      const result = await executePlan(plan, { client: createHelperClient(), approval });
      console.log(formatExecution(result));
      if (rest.includes("--json")) console.log(JSON.stringify(result, null, 2));
      return;
    }
    const result = await executePlan(plan, {
      client: createClient({ dryRun: true }),
      approval: { planId: plan.planId, confirm: true },
    });
    console.log(formatExecution(result));
    if (rest.includes("--json")) console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "status") {
    const client = createHelperClient();
    const status = await client.status();
    const summary = summarizeState(await client.readState());
    console.log(formatLiveStatus(status, summary));
    if (rest.includes("--json")) console.log(JSON.stringify({ status, summary }, null, 2));
    return;
  }

  if (command === "simulate") {
    const result = simulateResults({
      seed: optionValue(rest, "--seed", "flagpilot-demo"),
      users: Number(optionValue(rest, "--users", "300")),
      controlRate: Number(optionValue(rest, "--control-rate", "0.04")),
      variantRate: Number(optionValue(rest, "--variant-rate", "0.07")),
    });
    console.log(rest.includes("--json") ? JSON.stringify(result, null, 2) : formatSimulation(result));
    return;
  }

  if (command === "demo") {
    const plan = buildPlan(DEMO_INPUT);
    console.log(renderPlan(plan));
    console.log("");
    const result = await executePlan(plan, {
      client: createClient({ dryRun: true }),
      approval: { planId: plan.planId, confirm: true },
    });
    console.log(formatExecution(result));
    console.log("");
    console.log(formatSimulation(simulateResults({ seed: "flagpilot-demo", users: 300 })));
    return;
  }

  console.log(
    "usage: flagpilot plan | execute [--live --yes] | status | simulate [--seed S --users N] | demo"
  );
}

main(process.argv.slice(2)).catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
