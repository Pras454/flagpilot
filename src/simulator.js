// Local results simulator for demos. Deterministic (seeded) and clearly
// labeled: it sends NO Flagsmith events and its numbers are NOT live
// evidence. Use it to show the reporting shape while real warehouse events
// accumulate.

function hashSeed(seed) {
  const text = String(seed);
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < text.length; i++) {
    const k = text.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return (h1 ^ h2 ^ h3 ^ h4) >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rate(value, name) {
  if (typeof value !== "number" || Number.isNaN(value) || value < 0 || value > 1) {
    throw new Error(`${name} must be a number between 0 and 1`);
  }
  return value;
}

export function simulateResults({
  seed = "flagpilot-demo",
  users = 300,
  controlRate = 0.04,
  variantRate = 0.07,
  variantAllocation = 50,
  controlLabel = "control",
  variantLabel = "v_get_yours",
} = {}) {
  if (!Number.isInteger(users) || users < 1) throw new Error("users must be a positive integer");
  rate(controlRate, "controlRate");
  rate(variantRate, "variantRate");
  if (!Number.isInteger(variantAllocation) || variantAllocation < 1 || variantAllocation > 99) {
    throw new Error("variantAllocation must be an integer 1-99");
  }

  const rng = mulberry32(hashSeed(seed));
  const control = { key: controlLabel, exposures: 0, conversions: 0 };
  const variant = { key: variantLabel, exposures: 0, conversions: 0 };

  for (let i = 0; i < users; i++) {
    const inVariant = rng() * 100 < variantAllocation;
    const bucket = inVariant ? variant : control;
    bucket.exposures += 1;
    if (rng() < (inVariant ? variantRate : controlRate)) bucket.conversions += 1;
  }

  for (const bucket of [control, variant]) {
    bucket.conversionRate = bucket.exposures === 0 ? 0 : bucket.conversions / bucket.exposures;
  }

  const absoluteLift = variant.conversionRate - control.conversionRate;
  const relativeLift =
    control.conversionRate === 0 ? null : absoluteLift / control.conversionRate;
  const minExposures = Math.min(control.exposures, variant.exposures);

  let recommendation;
  if (minExposures < 100) {
    recommendation = "Collect more data before any rollout decision.";
  } else if (variant.conversionRate > control.conversionRate && (relativeLift ?? 0) >= 0.1) {
    recommendation =
      "Variant leads in this local simulation; roll out only after live Flagsmith results confirm it and a human approves.";
  } else {
    recommendation = "Keep control; the variant does not lead in this local simulation.";
  }

  return {
    mode: "local-simulation",
    disclaimer:
      "Local simulation only: no Flagsmith events were sent and these numbers are not live evidence.",
    seed: String(seed),
    users,
    variants: [control, variant],
    absoluteLift,
    relativeLift,
    recommendation,
  };
}

export function formatSimulation(result) {
  const pct = (value) => `${(value * 100).toFixed(1)}%`;
  const lines = [
    `Local simulation (seed: ${result.seed}, users: ${result.users})`,
    result.disclaimer,
    "",
    "Variant      Exposures  Conversions  Rate",
  ];
  for (const v of result.variants) {
    lines.push(
      `${v.key.padEnd(12)} ${String(v.exposures).padStart(9)}  ${String(v.conversions).padStart(11)}  ${pct(v.conversionRate)}`
    );
  }
  lines.push("");
  lines.push(
    `Absolute lift: ${(result.absoluteLift * 100).toFixed(2)} pp` +
      (result.relativeLift === null ? "" : `  Relative lift: ${pct(result.relativeLift)}`)
  );
  lines.push(`Recommendation: ${result.recommendation}`);
  return lines.join("\n");
}
