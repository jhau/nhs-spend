import { db } from "@/db";

import { runStages } from "./runner";
import {
  appendRunLog,
  ensureRunStageRow,
  getRun,
  setPipelineRunStatus,
  setRunStageStatus,
} from "./pipelineDb";
import { importSpendExcelStage } from "./stages";

const stages = [importSpendExcelStage];

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
  if (!run) return;

  const log = async (entry: {
    level: "debug" | "info" | "warn" | "error";
    message: string;
    meta?: Record<string, unknown>;
  }) => {
    await appendRunLog({ runId, ...entry });
  };

  await setPipelineRunStatus(runId, {
    status: "running",
    startedAt: new Date(),
    finishedAt: null,
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
        log,
        onStageStart: async (stageId) => {
          await setRunStageStatus(runId, stageId, {
            status: "running",
            startedAt: new Date(),
            finishedAt: null,
            error: null,
          });
        },
        onStageFinish: async (stageId, result) => {
          await setRunStageStatus(runId, stageId, {
            status: result.status,
            finishedAt: new Date(),
            metrics: result.metrics ?? null,
          });
        },
        onStageError: async (stageId, error) => {
          await setRunStageStatus(runId, stageId, {
            status: "failed",
            finishedAt: new Date(),
            error: error instanceof Error ? error.message : String(error),
          });
        },
      },
      stages,
      { assetId: run.assetId }
    );

    await setPipelineRunStatus(runId, {
      status: "succeeded",
      finishedAt: new Date(),
    });
  } catch (error) {
    await log({
      level: "error",
      message: "Pipeline run failed",
      meta: { error: error instanceof Error ? error.message : String(error) },
    });
    await setPipelineRunStatus(runId, {
      status: "failed",
      finishedAt: new Date(),
    });
  }
}

