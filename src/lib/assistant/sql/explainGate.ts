export type ExplainGateOptions = {
  maxTotalCost: number;
  maxPlanRows: number;
  /**
   * If true, reject a sequential scan on `spend_entries` with no filter.
   * This is a pragmatic guardrail for your largest table.
   */
  rejectSeqScanOnSpendEntriesWithoutFilter: boolean;
};

export type ExplainSummary = {
  totalCost: number | null;
  planRows: number | null;
  hasSeqScanOnSpendEntries: boolean;
  hasSeqScanOnSpendEntriesWithoutFilter: boolean;
  nodeTypes: Set<string>;
};

export class ExplainGateError extends Error {
  name = "ExplainGateError";
}

function walkPlan(node: any, summary: ExplainSummary) {
  if (!node || typeof node !== "object") return;

  const nodeType = node["Node Type"];
  if (typeof nodeType === "string") summary.nodeTypes.add(nodeType);

  const relationName = node["Relation Name"];
  const filter = node["Filter"];

  if (nodeType === "Seq Scan" && relationName === "spend_entries") {
    summary.hasSeqScanOnSpendEntries = true;
    if (!filter) summary.hasSeqScanOnSpendEntriesWithoutFilter = true;
  }

  const plans = node["Plans"];
  if (Array.isArray(plans)) {
    for (const child of plans) walkPlan(child, summary);
  }
}

export function summarizeExplainJson(explainJson: unknown): ExplainSummary {
  // EXPLAIN (FORMAT JSON) returns an array with a single object containing `Plan`
  const root = Array.isArray(explainJson) ? explainJson[0] : explainJson;
  const plan = (root as any)?.Plan;

  const summary: ExplainSummary = {
    totalCost:
      typeof (plan as any)?.["Total Cost"] === "number"
        ? (plan as any)["Total Cost"]
        : null,
    planRows:
      typeof (plan as any)?.["Plan Rows"] === "number"
        ? (plan as any)["Plan Rows"]
        : null,
    hasSeqScanOnSpendEntries: false,
    hasSeqScanOnSpendEntriesWithoutFilter: false,
    nodeTypes: new Set<string>(),
  };

  walkPlan(plan, summary);
  return summary;
}

export function enforceExplainGate(
  summary: ExplainSummary,
  opts: ExplainGateOptions
) {
  if (summary.totalCost != null && summary.totalCost > opts.maxTotalCost) {
    throw new ExplainGateError(
      `Query is too expensive (estimated total cost ${summary.totalCost} > ${opts.maxTotalCost}).`
    );
  }

  if (summary.planRows != null && summary.planRows > opts.maxPlanRows) {
    throw new ExplainGateError(
      `Query would scan too many rows (estimated ${summary.planRows} > ${opts.maxPlanRows}).`
    );
  }

  if (
    opts.rejectSeqScanOnSpendEntriesWithoutFilter &&
    summary.hasSeqScanOnSpendEntriesWithoutFilter
  ) {
    throw new ExplainGateError(
      "Query would perform a sequential scan on spend_entries without a filter; please add a date range and/or buyer filter."
    );
  }
}


