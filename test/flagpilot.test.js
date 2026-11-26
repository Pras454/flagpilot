import { test } from "node:test";
import assert from "node:assert/strict";

import { buildPlan, PlanError } from "../src/planner.js";
import { renderPlan, assertApproved, ApprovalError } from "../src/approval.js";
import { createClient, createHelperClient } from "../src/flagsmith.js";
import { executePlan, summarizeState, LiveTargetError } from "../src/executor.js";
import { simulateResults } from "../src/simulator.js";

const INPUT = {
  organisationId: 42351,
  projectId: 56691,
  environmentName: "Development",
  flagName: "checkout_button",
  controlValue: "Buy now",
  variations: [{ key: "v_get_yours", value: "Get yours", percentageAllocation: 50 }],
  successEvent: "purchase",
  metricName: "purchase",
  experimentName: "Checkout button copy",
};

const RUNNING_STATE = {
  environment: { id: 121261, name: "Development", project: 56691, api_key_present: true },
  warehouses: { items: [{ id: 13245, warehouse_type: "flagsmith", status: "created" }] },
  features: {
    items: [
      {
        id: 306271,
        name: "checkout_button",
        type: "MULTIVARIATE",
        initial_value: "Buy now",
        multivariate_options: [{ id: 37508, string_value: "Get yours" }],
      },
    ],
  },
  metrics: { items: [{ id: 821, name: "purchase", definition: { event: "purchase" } }] },
  experiments: {
    items: [
      {
        id: 786,
        name: "Checkout button copy",
        status: "running",
        feature: { id: 306271, name: "checkout_button" },
        metrics: [{ metric: 821, metric_name: "purchase" }],
      },
    ],
  },
};

test("planner builds the verified six-step plan with project-level flag creation", () => {
  const plan = buildPlan(INPUT);
  assert.deepEqual(
    plan.steps.map((s) => s.id),
    ["preflight", "warehouse", "flag", "metric", "experiment", "start"]
  );
  assert.equal(plan.steps[0].readOnly, true);
  assert.equal(plan.steps.find((s) => s.id === "flag").path, "/projects/56691/features/");
  const metric = plan.steps.find((s) => s.id === "metric");
  assert.equal(metric.body.definition.event, "purchase");
  const experiment = plan.steps.find((s) => s.id === "experiment");
  assert.equal(
    experiment.body.experiment_rollout.multivariate_feature_state_values[0].percentage_allocation,
    50
  );
});

test("planner rejects a variation without a key (records no exposure)", () => {
  assert.throws(
    () => buildPlan({ ...INPUT, variations: [{ value: "X", percentageAllocation: 50 }] }),
    PlanError
  );
});

test("planner rejects allocations over 100%", () => {
  assert.throws(
    () =>
      buildPlan({
        ...INPUT,
        variations: [
          { key: "a", value: "A", percentageAllocation: 60 },
          { key: "b", value: "B", percentageAllocation: 60 },
        ],
      }),
    PlanError
  );
});

test("planner preserves event-name case exactly", () => {
  const plan = buildPlan({ ...INPUT, successEvent: "PurchaseCompleted" });
  const metric = plan.steps.find((s) => s.id === "metric");
  assert.equal(metric.body.definition.event, "PurchaseCompleted");
});

test("approval gate blocks execution without human confirmation", async () => {
  const plan = buildPlan(INPUT);
  const client = createClient({ dryRun: true });
  await assert.rejects(() => executePlan(plan, { client, approval: null }), ApprovalError);
  await assert.rejects(
    () => executePlan(plan, { client, approval: { planId: "other", confirm: true } }),
    ApprovalError
  );
  assert.equal(client.requests.length, 0);
});

test("approved dry-run records steps and makes no network calls", async () => {
  const plan = buildPlan(INPUT);
  const client = createClient({ dryRun: true });
  const result = await executePlan(plan, {
    client,
    approval: { planId: plan.planId, confirm: true },
  });
  assert.equal(result.mode, "dry-run");
  assert.equal(result.completed.length, 6);
  assert.equal(client.requests.length, 6);
  assert.ok(client.requests.some((r) => r.path === "/projects/56691/features/"));
});

test("rendered plan shows every write before approval", () => {
  const text = renderPlan(buildPlan(INPUT));
  assert.match(text, /warehouse-connections/);
  assert.match(text, /experiment-metrics/);
  assert.match(text, /No writes happen until this plan is approved/);
  assert.match(text, /reuses a matching running experiment/);
});

test("live executor reuses a matching running experiment without ensure writes", async () => {
  const plan = buildPlan(INPUT);
  let ensureCalls = 0;
  const client = {
    dryRun: false,
    status: async () => ({ organisation_id: 42351, project_id: 56691 }),
    readState: async () => RUNNING_STATE,
    ensureExperiment: async () => {
      ensureCalls += 1;
      return {};
    },
  };
  const result = await executePlan(plan, {
    client,
    approval: { planId: plan.planId, confirm: true },
  });
  assert.equal(result.mode, "live");
  assert.equal(result.reused, true);
  assert.equal(ensureCalls, 0);
  assert.equal(result.verification.experiment.id, 786);
  assert.equal(result.verification.experiment.status, "running");
});

test("live executor ensures missing pieces once, then verifies running", async () => {
  const plan = buildPlan(INPUT);
  let reads = 0;
  let ensureCalls = 0;
  const emptyState = {
    environment: RUNNING_STATE.environment,
    warehouses: { items: [] },
    features: { items: [] },
    metrics: { items: [] },
    experiments: { items: [] },
  };
  const client = {
    dryRun: false,
    status: async () => ({ organisation_id: 42351, project_id: 56691 }),
    readState: async () => (++reads === 1 ? emptyState : RUNNING_STATE),
    ensureExperiment: async () => {
      ensureCalls += 1;
      return {
        warehouse: { created: true },
        feature: { created: true },
        metric: { created: true },
        experiment: { created: true },
        start: { started: true },
      };
    },
  };
  const result = await executePlan(plan, {
    client,
    approval: { planId: plan.planId, confirm: true },
  });
  assert.equal(ensureCalls, 1);
  assert.equal(result.reused, false);
  assert.equal(result.verification.experiment.status, "running");
});

test("live executor fails closed for an unverified live target", async () => {
  const plan = buildPlan({ ...INPUT, flagName: "other_flag" });
  const client = {
    dryRun: false,
    status: async () => ({}),
    readState: async () => RUNNING_STATE,
    ensureExperiment: async () => ({}),
  };
  await assert.rejects(
    () => executePlan(plan, { client, approval: { planId: plan.planId, confirm: true } }),
    LiveTargetError
  );
});

test("helper client parses helper JSON through the injected runner", async () => {
  const client = createHelperClient({
    runner: async (command) => ({ command, ok: true }),
  });
  assert.deepEqual(await client.status(), { command: "status", ok: true });
  assert.deepEqual(await client.readState(), { command: "gate1-read", ok: true });
});

test("summarizeState exposes ids and status without environment keys", () => {
  const summary = summarizeState(RUNNING_STATE);
  assert.equal(summary.environment.apiKeyPresent, true);
  assert.equal(summary.feature.options[0].id, 37508);
  assert.equal(summary.metric.event, "purchase");
  assert.equal(JSON.stringify(summary).includes("api_key"), false);
});

test("simulator is deterministic for a fixed seed and labels itself local", () => {
  const first = simulateResults({ seed: "demo-seed", users: 300 });
  const second = simulateResults({ seed: "demo-seed", users: 300 });
  assert.deepEqual(first, second);
  assert.equal(first.mode, "local-simulation");
  assert.match(first.disclaimer, /not live evidence/);
  assert.equal(
    first.variants.reduce((sum, v) => sum + v.exposures, 0),
    300
  );
  for (const v of first.variants) {
    assert.ok(v.conversions <= v.exposures);
    assert.ok(v.conversionRate >= 0 && v.conversionRate <= 1);
  }
});

test("simulator recommends more data for a tiny sample", () => {
  const result = simulateResults({ seed: "tiny", users: 20 });
  assert.match(result.recommendation, /Collect more data/);
});
