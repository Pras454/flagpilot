// Human-readable reporting for live readbacks. Contains no secrets: the
// helper output already omits environment keys and credentials.

export function formatLiveStatus(status, summary) {
  const env = summary?.environment;
  const lines = [
    "Flagsmith live status (read-only)",
    `Organisation: ${status?.organisation_id ?? "unknown"}`,
    `Project: ${status?.project_id ?? env?.project ?? "unknown"}`,
    `Environment: ${env?.name ?? "unknown"} (id ${env?.id ?? "unknown"})`,
    `Warehouse: ${summary?.warehouse ? `${summary.warehouse.type} #${summary.warehouse.id} (${summary.warehouse.status})` : "missing"}`,
    `Flag: ${summary?.feature ? `${summary.feature.name} #${summary.feature.id}` : "missing"}`,
    `Metric: ${summary?.metric ? `${summary.metric.name} #${summary.metric.id} (event: ${summary.metric.event})` : "missing"}`,
    `Experiment: ${summary?.experiment ? `${summary.experiment.name} #${summary.experiment.id} (${summary.experiment.status})` : "missing"}`,
  ];
  return lines.join("\n");
}

export function formatExecution(result) {
  if (result.mode === "dry-run") {
    return `Dry-run complete for ${result.planId}: ${result.completed.length} steps recorded, no network calls.`;
  }
  const lines = [
    result.reused
      ? `Live plan ${result.planId}: matching running experiment reused; no duplicate writes.`
      : `Live plan ${result.planId}: missing pieces ensured and experiment verified running.`,
  ];
  const exp = result.verification?.experiment;
  if (exp) lines.push(`Experiment: ${exp.name} #${exp.id} (${exp.status})`);
  const feature = result.verification?.feature;
  if (feature) lines.push(`Flag: ${feature.name} #${feature.id}`);
  const metric = result.verification?.metric;
  if (metric) lines.push(`Metric: ${metric.name} #${metric.id} (event: ${metric.event})`);
  return lines.join("\n");
}
