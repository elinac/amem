/**
 * Offline recall eval metrics (Phase 2).
 * Pure functions — no I/O.
 */

export function precisionAtK(retrievedIds, relevantIds, k) {
  const top = retrievedIds.slice(0, k);
  if (top.length === 0) return relevantIds.length === 0 ? 1 : 0;
  const rel = new Set(relevantIds);
  let hits = 0;
  for (const id of top) if (rel.has(id)) hits += 1;
  return hits / top.length;
}

export function recallAtK(retrievedIds, relevantIds, k) {
  if (!relevantIds.length) return 1;
  const top = new Set(retrievedIds.slice(0, k));
  let hits = 0;
  for (const id of relevantIds) if (top.has(id)) hits += 1;
  return hits / relevantIds.length;
}

/** injectable ∩ harmful / injectable */
export function harmfulInjectionRate(injectableIds, harmfulIds) {
  if (!injectableIds.length) return 0;
  const harm = new Set(harmfulIds ?? []);
  let n = 0;
  for (const id of injectableIds) if (harm.has(id)) n += 1;
  return n / injectableIds.length;
}

/** Share of Top-K hits that are conflict-status or have conflicts_with. */
export function conflictExposureRate(retrievedIds, memoryById) {
  if (!retrievedIds.length) return 0;
  let n = 0;
  for (const id of retrievedIds) {
    const m = memoryById.get(id);
    if (!m) continue;
    if (m.status === "conflict" || (m.conflicts_with ?? []).length > 0) n += 1;
  }
  return n / retrievedIds.length;
}

export function budgetUtilization(usedTokens, budgetTokens) {
  if (!budgetTokens || budgetTokens <= 0) return 0;
  return usedTokens / budgetTokens;
}

export function macroAverage(values) {
  if (!values.length) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

/** Default CI / rollback gates (calibrated in C2.5 against v0). */
export const DEFAULT_GATES = {
  k: 8,
  minPrecisionAtK: 0.5,
  maxHarmfulInjectionRate: 0.02,
  maxConflictExposureRate: 0.15,
  /** Only enforced when packs are non-thin (see evaluateGates). */
  minBudgetUtilization: 0.4,
  maxBudgetUtilization: 0.95,
  thinPackBudgetUtilization: 0.15,
  rollbackDeltaPrecision: -0.05,
  rollbackHarmfulAbsIncrease: 0.01,
};

export function evaluateGates(metrics, gates = DEFAULT_GATES) {
  const failures = [];
  if (metrics.precision_at_k < gates.minPrecisionAtK) {
    failures.push(
      `precision_at_k ${metrics.precision_at_k.toFixed(3)} < ${gates.minPrecisionAtK}`,
    );
  }
  if (metrics.harmful_injection_rate > gates.maxHarmfulInjectionRate) {
    failures.push(
      `harmful_injection_rate ${metrics.harmful_injection_rate.toFixed(3)} > ${gates.maxHarmfulInjectionRate}`,
    );
  }
  if (metrics.conflict_exposure_rate > gates.maxConflictExposureRate) {
    failures.push(
      `conflict_exposure_rate ${metrics.conflict_exposure_rate.toFixed(3)} > ${gates.maxConflictExposureRate}`,
    );
  }
  const bu = metrics.budget_utilization;
  // Thin synthetic packs under-fill budget; skip min gate when clearly under-utilized
  // without budget drops (design: 空库/过瘦除外).
  if (bu > gates.maxBudgetUtilization) {
    failures.push(
      `budget_utilization ${bu.toFixed(3)} > ${gates.maxBudgetUtilization}`,
    );
  } else if (
    bu >= gates.thinPackBudgetUtilization &&
    bu < gates.minBudgetUtilization &&
    (metrics.budget_drop_count ?? 0) > 0
  ) {
    failures.push(
      `budget_utilization ${bu.toFixed(3)} < ${gates.minBudgetUtilization} with budget drops`,
    );
  }
  return failures;
}
