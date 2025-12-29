import { PipelineError, type PipelineContext, type PipelineStage } from "./types";

export type PipelineRunnerOptions = {
  runId: number;
  dryRun: boolean;
  db: PipelineContext["db"];
  log: PipelineContext["log"];
  onStageStart?: (stageId: string) => Promise<void> | void;
  onStageFinish?: (
    stageId: string,
    result: { status: string; metrics?: Record<string, unknown> }
  ) => Promise<void> | void;
  onStageError?: (stageId: string, error: unknown) => Promise<void> | void;
};

export type RunStagesOptions = {
  /**
   * Inclusive start stage id.
   */
  fromStageId?: string;
  /**
   * Inclusive end stage id.
   */
  toStageId?: string;
};

/**
 * Minimal in-process runner. Persistence (run/stage status, logs) is handled
 * by the caller via injected hooks/loggers.
 */
export async function runStages<Input>(
  options: PipelineRunnerOptions,
  stages: Array<PipelineStage<Input>>,
  input: Input,
  runOptions: RunStagesOptions = {}
) {
  const ctxBase: PipelineContext = {
    db: options.db,
    runId: options.runId,
    dryRun: options.dryRun,
    log: options.log,
  };

  if (stages.length === 0) {
    throw new PipelineError("no_stages", "No pipeline stages provided");
  }

  const stageIds = stages.map((s) => s.id);
  const fromIdx =
    runOptions.fromStageId === undefined
      ? 0
      : stageIds.indexOf(runOptions.fromStageId);
  const toIdx =
    runOptions.toStageId === undefined ? stages.length - 1 : stageIds.indexOf(runOptions.toStageId);

  if (fromIdx === -1) {
    throw new PipelineError("invalid_from_stage", `Unknown fromStageId '${runOptions.fromStageId}'`);
  }
  if (toIdx === -1) {
    throw new PipelineError("invalid_to_stage", `Unknown toStageId '${runOptions.toStageId}'`);
  }
  if (fromIdx > toIdx) {
    throw new PipelineError("invalid_stage_range", "fromStageId must be before toStageId");
  }

  const results: Array<{ stageId: string; result: unknown }> = [];

  for (let i = 0; i < stages.length; i++) {
    const stage = stages[i];
    const isInRange = i >= fromIdx && i <= toIdx;
    if (!isInRange) {
      continue;
    }

    const ctx: PipelineContext = { ...ctxBase, stageId: stage.id };

    await ctx.log({ level: "info", message: `Stage started: ${stage.title}`, meta: { stageId: stage.id } });
    await options.onStageStart?.(stage.id);

    try {
      stage.validate?.(input);
      const result = await stage.run(ctx, input);
      results.push({ stageId: stage.id, result });
      await ctx.log({
        level: "info",
        message: `Stage finished: ${stage.title} (${result.status})`,
        meta: { stageId: stage.id, status: result.status, metrics: result.metrics },
      });
      await options.onStageFinish?.(stage.id, {
        status: result.status,
        metrics: result.metrics,
      });

      if (result.status === "failed") {
        throw new PipelineError("stage_failed", `Stage '${stage.id}' reported failure`, {
          stageId: stage.id,
        });
      }
    } catch (err) {
      await ctx.log({
        level: "error",
        message: `Stage error: ${stage.title}`,
        meta: { stageId: stage.id, error: err instanceof Error ? err.message : String(err) },
      });
      await options.onStageError?.(stage.id, err);
      throw err;
    }
  }

  return { results };
}

