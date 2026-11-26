// Executor: runs an approved plan. Dry-run is the default and only records
// steps. Live mode reads Flagsmith state first through the verified helper,
// reuses a matching running experiment (no duplicate writes), and only
// calls the helper's idempotent ensure flow when something is missing.

import { assertApproved } from "./approval.js";

export class LiveTargetError extends Error {}

// The helper's verified live target (Gate 1, 27 Nov 2026). Live execution
// fails closed for any other plan until the helper is generalized.
export const VERIFIED_LIVE_TARGET = {
  projectId: 56691,
  environmentName: "Development",
  flagName: "checkout_button",
  controlValue: "Buy now",
  variationValue: "Get yours",
  variationAllocation: 50,
  successEvent: "purchase",
  metricName: "purchase",
  experimentName: "Checkout button copy",
};

export async function executePlan(plan, { client, approval } = {}) {
  assertApproved(plan, approval);
  if (!client) throw new Error("executePlan requires a Flagsmith client");

  if (client.dryRun) {
    const completed = plan.steps.map((step) => ({
      step: step.id,
      result: client.recordStep(step),
    }));
    return { planId: plan.planId, mode: "dry-run", completed };
  }

  return executeLive(plan, client);
}

function assertLiveTarget(plan) {
  const t = VERIFIED_LIVE_TARGET;
  const variation = plan.variations?.[0];
  const matches =
    plan.target?.projectId === t.projectId &&
    plan.target?.environmentName === t.environmentName &&
    plan.flagName === t.flagName &&
    plan.controlValue === t.controlValue &&
    plan.variations?.length === 1 &&
    variation?.value === t.variationValue &&
    variation?.percentageAllocation === t.variationAllocation &&
    plan.successEvent === t.successEvent &&
    plan.metricName === t.metricName &&
    plan.experimentName === t.experimentName;
  if (!matches) {
    throw new LiveTargetError(
      "live execution is verified only for the Gate-1 demo target " +
        `(project ${t.projectId}, flag ${t.flagName}, experiment '${t.experimentName}'); ` +
        "use dry-run for other plans"
    );
  }
}

function items(section) {
  return section?.items ?? [];
}

export function summarizeState(state) {
  const experiment = items(state?.experiments)[0] ?? null;
  const feature = items(state?.features)[0] ?? experiment?.feature ?? null;
  const metric = items(state?.metrics)[0] ?? null;
  const warehouse = items(state?.warehouses)[0] ?? null;
  return {
    environment: state?.environment
      ? {
          id: state.environment.id,
          name: state.environment.name,
          project: state.environment.project,
          apiKeyPresent: state.environment.api_key_present === true,
        }
      : null,
    warehouse: warehouse
      ? { id: warehouse.id, type: warehouse.warehouse_type, status: warehouse.status }
      : null,
    feature: feature
      ? {
          id: feature.id,
          name: feature.name,
          type: feature.type,
          initialValue: feature.initial_value,
          options: (feature.multivariate_options ?? []).map((o) => ({
            id: o.id,
            value: o.string_value,
          })),
        }
      : null,
    metric: metric
      ? { id: metric.id, name: metric.name, event: metric.definition?.event ?? null }
      : null,
    experiment: experiment
      ? {
          id: experiment.id,
          name: experiment.name,
          status: experiment.status,
          featureName: experiment.feature?.name ?? null,
          metrics: (experiment.metrics ?? []).map((m) => ({
            id: m.metric,
            name: m.metric_name,
          })),
        }
      : null,
  };
}

function isReady(summary, plan) {
  return Boolean(
    summary.warehouse &&
      summary.feature?.name === plan.flagName &&
      summary.metric?.name === plan.metricName &&
      summary.experiment?.name === plan.experimentName &&
      String(summary.experiment?.status ?? "").toLowerCase() === "running"
  );
}

async function executeLive(plan, client) {
  assertLiveTarget(plan);
  if (typeof client.status !== "function" || typeof client.readState !== "function") {
    throw new Error("live client must provide status() and readState()");
  }

  const status = await client.status();
  const before = summarizeState(await client.readState());

  if (isReady(before, plan)) {
    return {
      planId: plan.planId,
      mode: "live",
      reused: true,
      completed: plan.steps.map((step) => ({
        step: step.id,
        result:
          step.id === "preflight"
            ? { readOnly: true, status }
            : { skipped: true, reason: "matching running experiment already exists" },
      })),
      verification: before,
    };
  }

  if (typeof client.ensureExperiment !== "function") {
    throw new Error("live client must provide ensureExperiment()");
  }
  const ensured = await client.ensureExperiment(plan);
  const after = summarizeState(await client.readState());
  if (!isReady(after, plan)) {
    throw new Error("live ensure finished but the experiment is not running; refusing to claim success");
  }

  const created = (section) => section?.created === true;
  return {
    planId: plan.planId,
    mode: "live",
    reused: false,
    completed: [
      { step: "preflight", result: { readOnly: true, status } },
      { step: "warehouse", result: { created: created(ensured?.warehouse) } },
      { step: "flag", result: { created: created(ensured?.feature) } },
      { step: "metric", result: { created: created(ensured?.metric) } },
      { step: "experiment", result: { created: created(ensured?.experiment) } },
      { step: "start", result: { started: ensured?.start?.started === true } },
    ],
    verification: after,
  };
}
