// Approval gate: FlagPilot performs NO write to Flagsmith until a human has
// seen the exact plan and approved it. CLI mode asks interactively (or
// requires an explicit --yes after rendering the plan); MCP mode requires
// execute_plan to carry the plan_id plus confirm: true.

export class ApprovalError extends Error {}

export function renderPlan(plan) {
  const target = plan.target ?? {};
  const lines = [
    `PLAN ${plan.planId}  (project: ${target.projectId}, environment: ${target.environmentName}, flag: ${plan.flagName})`,
    "",
  ];
  plan.steps.forEach((step, i) => {
    const notes = [
      step.readOnly ? "[read-only]" : null,
      step.onlyIfMissing ? "[only if missing]" : null,
      step.onlyIfNotRunning ? "[only if not running]" : null,
    ]
      .filter(Boolean)
      .join(" ");
    lines.push(`  ${i + 1}. ${step.description}`);
    lines.push(`     ${step.method} ${step.path}${notes ? `  ${notes}` : ""}`);
    if (step.body && Object.keys(step.body).length > 0) {
      lines.push(`     ${JSON.stringify(step.body)}`);
    }
  });
  lines.push("");
  lines.push("No writes happen until this plan is approved.");
  lines.push("Live execution reuses a matching running experiment instead of creating a duplicate.");
  return lines.join("\n");
}

export function assertApproved(plan, approval) {
  if (!approval || approval.confirm !== true) {
    throw new ApprovalError(
      `plan ${plan.planId} is not approved: a human must confirm before any write`
    );
  }
  if (approval.planId !== plan.planId) {
    throw new ApprovalError(
      `approval is for plan ${approval.planId}, not ${plan.planId}`
    );
  }
  return true;
}
