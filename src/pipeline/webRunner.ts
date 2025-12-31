import { db } from "@/db";

import { runStages } from "./runner";
import {
  ensureRunStageRow,
  getRun,
  setPipelineRunStatus,
  setRunStageStatus,
} from "./pipelineDb";
import { createPipelineLogger } from "./logger";
import {
  importSpendExcelStage,
  importCouncilSpendExcelStage,
  importGovDeptSpendExcelStage,
  matchSuppliersStage,
} from "./stages";

const queue: number[] = [];
let isProcessing = false;

export function enqueuePipelineRun(runId: number) {
  queue.push(runId);
  void processQueue();
}

async function processQueue() {
  if (isProcessing) return;
  isProcessing = true;

  try {
    while (queue.length > 0) {
      const runId = queue.shift();
      if (!runId) continue;
      await runOne(runId);
    }
  } finally {
    isProcessing = false;
  }
}

async function runOne(runId: number) {
  const run = await getRun(runId);
  if (!run) {
    return;
  }

  const logger = createPipelineLogger(runId);
  const startTime = Date.now();

  await logger.log({
    level: "info",
    message: `Pipeline run started`,
    meta: { runId, assetId: run.assetId, dryRun: run.dryRun },
  });

  await setPipelineRunStatus(runId, {
    status: "running",
    startedAt: new Date(),
    finishedAt: null,
  });

  const importStage =
    run.orgType === "council"
      ? importCouncilSpendExcelStage
      : run.orgType === "government_department"
      ? importGovDeptSpendExcelStage
      : importSpendExcelStage;

  const stages = [importStage, matchSuppliersStage];

  await logger.log({
    level: "debug",
    message: `Initializing ${stages.length} pipeline stage(s)`,
    meta: { stageIds: stages.map((s) => s.id), orgType: run.orgType },
  });

  for (const stage of stages) {
    await ensureRunStageRow(runId, stage.id);
  }

  try {
    await runStages(
      {
        runId,
        dryRun: run.dryRun,
        db,
        log: logger.log,
        onStageStart: async (stageId) => {
          await logger.log({
            level: "info",
            message: `Stage starting: ${stageId}`,
            meta: { stageId },
          });
          await setRunStageStatus(runId, stageId, {
            status: "running",
            startedAt: new Date(),
            finishedAt: null,
            error: null,
          });
        },
        onStageFinish: async (stageId, result) => {
          await logger.log({
            level: "info",
            message: `Stage completed: ${stageId}`,
            meta: { stageId, status: result.status, metrics: result.metrics },
          });
          await setRunStageStatus(runId, stageId, {
            status: result.status,
            finishedAt: new Date(),
            metrics: result.metrics ?? null,
          });
        },
        onStageError: async (stageId, error) => {
          const errorMessage = error instanceof Error ? error.message : String(error);
          const errorStack = error instanceof Error ? error.stack : undefined;
          await logger.log({
            level: "error",
            message: `Stage failed: ${stageId}`,
            meta: { stageId, error: errorMessage, stack: errorStack },
          });
          await setRunStageStatus(runId, stageId, {
            status: "failed",
            finishedAt: new Date(),
            error: errorMessage,
          });
        },
      },
      stages,
      { 
        assetId: run.assetId as number,
        limit: 100, // Default limit for matching if applicable
        autoMatchThreshold: 0.9,
        minSimilarityThreshold: 0.5,
        ...(run.params || {})
      },
      {
        fromStageId: run.fromStageId ?? undefined,
        toStageId: run.toStageId ?? undefined,
      }
    );

    const duration = Date.now() - startTime;
    await logger.log({
      level: "info",
      message: `Pipeline run succeeded`,
      meta: { runId, durationMs: duration },
    });
    await setPipelineRunStatus(runId, {
      status: "succeeded",
      finishedAt: new Date(),
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    await logger.log({
      level: "error",
      message: "Pipeline run failed",
      meta: {
        runId,
        durationMs: duration,
        error: errorMessage,
        stack: errorStack,
      },
    });
    await setPipelineRunStatus(runId, {
      status: "failed",
      finishedAt: new Date(),
    });
  }
}

