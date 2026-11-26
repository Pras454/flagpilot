// Planner: turns a plain-language experiment description (already broken
// into structured fields by the interview or an optional LLM step) into an
// ExperimentPlan: the exact Flagsmith reads/writes FlagPilot would perform.
// The planner performs NO network calls and NO writes.

const FLAG_NAME_RE = /^[a-z][a-z0-9_]*$/;
const ENV_PLACEHOLDER = "<environment key>";

export class PlanError extends Error {}

function fail(message) {
  throw new PlanError(message);
}

export function buildPlan(input, { now = new Date() } = {}) {
  if (!input || typeof input !== "object") fail("plan input is required");

  const {
    organisationId = null,
    projectId,
    environmentName,
    flagName,
    controlValue,
    variations,
    successEvent,
    metricName,
    experimentName,
    hypothesis,
    rolloutPercentage = 100,
  } = input;

  if (!Number.isInteger(projectId) || projectId < 1) {
    fail("projectId must be a positive integer");
  }
  if (typeof environmentName !== "string" || environmentName.length === 0) {
    fail("environmentName is required");
  }
  if (!FLAG_NAME_RE.test(flagName ?? "")) {
    fail(`flag name must match ${FLAG_NAME_RE} (got: ${flagName})`);
  }
  if (typeof controlValue !== "string" || controlValue.length === 0) {
    fail("control value is required");
  }
  if (!Array.isArray(variations) || variations.length === 0) {
    fail("at least one variation is required");
  }

  const seenKeys = new Set();
  let allocated = 0;
  for (const v of variations) {
    // Flagsmith rule: a variation without a key records no exposure at all.
    if (!v.key) fail("every variation needs a key (keyless variations record no exposure)");
    if (v.key === "control") fail("variation key 'control' is reserved for the flag value itself");
    if (seenKeys.has(v.key)) fail(`duplicate variation key: ${v.key}`);
    seenKeys.add(v.key);
    if (typeof v.value !== "string" || v.value.length === 0) {
      fail(`variation ${v.key} needs a value`);
    }
    const pct = v.percentageAllocation;
    if (!Number.isInteger(pct) || pct < 1 || pct > 100) {
      fail(`variation ${v.key} percentageAllocation must be an integer 1-100`);
    }
    allocated += pct;
  }
  if (allocated > 100) fail(`variation allocations sum to ${allocated}%, over 100%`);

  // Flagsmith rule: event names are case-sensitive and must match the metric
  // definition exactly; mismatches are silently ignored. Preserve as given.
  if (typeof successEvent !== "string" || successEvent.length === 0) {
    fail("success event name is required");
  }
  if (!Number.isInteger(rolloutPercentage) || rolloutPercentage < 1 || rolloutPercentage > 100) {
    fail("rolloutPercentage must be an integer 1-100");
  }

  const resolvedMetricName = metricName ?? successEvent;
  const resolvedExperimentName = experimentName ?? flagName;
  const planId = `fp-${now.toISOString().replace(/[-:T]/g, "").slice(0, 14)}`;

  const steps = [
    {
      id: "preflight",
      description:
        "Read current Flagsmith state (environment, warehouse, flag, metric, experiments); reuse a matching running experiment instead of creating a duplicate",
      method: "GET",
      path: `/environments/?project=${projectId}`,
      readOnly: true,
    },
    {
      id: "warehouse",
      description: "Ensure a managed Flagsmith warehouse exists for the environment",
      method: "POST",
      path: `/environments/${ENV_PLACEHOLDER}/warehouse-connections/`,
      body: { warehouse_type: "flagsmith" },
      onlyIfMissing: true,
    },
    {
      id: "flag",
      description: `Ensure multivariate flag '${flagName}' exists (control='${controlValue}', enabled) with keyed variations`,
      method: "POST",
      path: `/projects/${projectId}/features/`,
      body: {
        name: flagName,
        type: "MULTIVARIATE",
        default_enabled: true,
        initial_value: controlValue,
        multivariate_options: variations.map((v) => ({
          key: v.key,
          string_value: v.value,
          default_percentage_allocation: 0,
        })),
      },
      onlyIfMissing: true,
    },
    {
      id: "metric",
      description: `Ensure metric '${resolvedMetricName}' exists counting '${successEvent}' events`,
      method: "POST",
      path: `/environments/${ENV_PLACEHOLDER}/experiment-metrics/`,
      body: {
        name: resolvedMetricName,
        aggregation: "occurrence",
        direction: "up",
        definition: { version: 1, event: successEvent },
      },
      onlyIfMissing: true,
    },
    {
      id: "experiment",
      description: `Ensure experiment '${resolvedExperimentName}' exists (reuse it if already present)`,
      method: "POST",
      path: `/environments/${ENV_PLACEHOLDER}/experiments/`,
      body: {
        feature: "<flag id from step 'flag'>",
        name: resolvedExperimentName,
        hypothesis: hypothesis ?? "",
        metrics: [{ metric: "<metric id from step 'metric'>", expected_direction: "increase" }],
        experiment_rollout: {
          enabled: true,
          rollout_percentage: rolloutPercentage,
          feature_state_value: { type: "string", value: "control" },
          multivariate_feature_state_values: variations.map((v) => ({
            multivariate_feature_option: `<variation id for ${v.key}>`,
            percentage_allocation: v.percentageAllocation,
          })),
        },
      },
      onlyIfMissing: true,
    },
    {
      id: "start",
      description: "Start the experiment only if it is not already running (starting locks the flag)",
      method: "POST",
      path: `/environments/${ENV_PLACEHOLDER}/experiments/<experiment id>/start/`,
      body: {},
      onlyIfNotRunning: true,
    },
  ];

  return {
    planId,
    createdAt: now.toISOString(),
    target: {
      organisationId,
      projectId,
      environmentName,
    },
    flagName,
    controlValue,
    variations: variations.map((v) => ({ ...v })),
    successEvent,
    metricName: resolvedMetricName,
    experimentName: resolvedExperimentName,
    hypothesis: hypothesis ?? "",
    rolloutPercentage,
    steps,
  };
}
