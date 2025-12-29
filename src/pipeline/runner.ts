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

  await options.log({
    level: "debug",
    message: `Executing stages ${fromIdx + 1}-${toIdx + 1} of ${stages.length}`,
    meta: { fromIdx, toIdx, totalStages: stages.length },
  });

  for (let i = 0; i < stages.length; i++) {
    const stage = stages[i];
    const isInRange = i >= fromIdx && i <= toIdx;
    if (!isInRange) {
      await options.log({
        level: "debug",
        message: `Skipping stage ${stage.id} (out of range)`,
        meta: { stageId: stage.id, index: i },
      });
      continue;
    }

    const ctx: PipelineContext = { ...ctxBase, stageId: stage.id };
    const stageStartTime = Date.now();

    await ctx.log({
      level: "info",
      message: `Stage started: ${stage.title}`,
      meta: { stageId: stage.id, stageIndex: i + 1, totalStages: stages.length },
    });
    await options.onStageStart?.(stage.id);

    try {
      if (stage.validate) {
        await ctx.log({
          level: "debug",
          message: `Validating stage input`,
          meta: { stageId: stage.id },
        });
        stage.validate(input);
        await ctx.log({
          level: "debug",
          message: `Stage input validation passed`,
          meta: { stageId: stage.id },
        });
      }

      await ctx.log({
        level: "debug",
        message: `Executing stage run function`,
        meta: { stageId: stage.id },
      });
      const result = await stage.run(ctx, input);
      const stageDuration = Date.now() - stageStartTime;

      results.push({ stageId: stage.id, result });
      await ctx.log({
        level: "info",
        message: `Stage finished: ${stage.title} (${result.status})`,
        meta: {
          stageId: stage.id,
          status: result.status,
          metrics: result.metrics,
          durationMs: stageDuration,
          warnings: result.warnings?.length ?? 0,
        },
      });

      if (result.warnings && result.warnings.length > 0) {
        await ctx.log({
          level: "warn",
          message: `Stage completed with ${result.warnings.length} warning(s)`,
          meta: { stageId: stage.id, warnings: result.warnings },
        });
      }

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
      const stageDuration = Date.now() - stageStartTime;
      const errorMessage = err instanceof Error ? err.message : String(err);
      const errorStack = err instanceof Error ? err.stack : undefined;
      await ctx.log({
        level: "error",
        message: `Stage error: ${stage.title}`,
        meta: {
          stageId: stage.id,
          error: errorMessage,
          stack: errorStack,
          durationMs: stageDuration,
        },
      });
      await options.onStageError?.(stage.id, err);
      throw err;
    }
  }

  return { results };
}

