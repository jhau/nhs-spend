import type { DbClient } from "@/db";

export type PipelineLogLevel = "debug" | "info" | "warn" | "error";

export type PipelineLogger = (entry: {
  level: PipelineLogLevel;
  message: string;
  meta?: Record<string, unknown>;
}) => Promise<void> | void;

export type StageStatus = "queued" | "running" | "succeeded" | "failed" | "skipped";

export type PipelineStageResult = {
  status: Exclude<StageStatus, "queued" | "running">;
  metrics?: Record<string, unknown>;
  warnings?: string[];
};

export type PipelineStage<Input> = {
  id: string;
  title: string;
  validate?: (input: Input) => void;
  run: (ctx: PipelineContext, input: Input) => Promise<PipelineStageResult>;
};

export type PipelineContext = {
  db: DbClient;
  /**
   * The pipeline run id (DB primary key). Stages should attach this to logs/audit.
   */
  runId: number;
  /**
   * Optional stage id set by the runner during execution.
   */
  stageId?: string;
  /**
   * Dry-run mode: stages should avoid mutating data where feasible.
   */
  dryRun: boolean;
  /**
   * Logger that writes to pipeline_run_logs (and optionally console).
   */
  log: PipelineLogger;
};

export class PipelineError extends Error {
  readonly code: string;
  readonly meta?: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    meta?: Record<string, unknown>,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = "PipelineError";
    this.code = code;
    this.meta = meta;
  }
}

