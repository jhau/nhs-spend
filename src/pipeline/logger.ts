import pino from "pino";
import type { PipelineLogLevel } from "./types";
import { appendRunLog } from "./pipelineDb";
import { broadcastLog } from "./logBroadcaster";

/**
 * Creates a logger that uses pino for structured logging and also writes to the database.
 * The logger maintains the same interface as the original PipelineLogger for compatibility.
 */
export function createPipelineLogger(runId: number): {
  log: (entry: {
    level: PipelineLogLevel;
    message: string;
    meta?: Record<string, unknown>;
  }) => Promise<void>;
} {
  // Create pino logger with structured output
  // Note: pino-pretty transport disabled due to worker thread issues in Next.js
  // Using default JSON output which is more reliable
  const pinoLogger = pino({
    level: process.env.LOG_LEVEL || "info",
    formatters: {
      level: (label) => {
        return { level: label };
      },
    },
    base: {
      runId,
    },
    // No transport - pino-pretty causes worker thread issues in Next.js
    // Default JSON output works reliably
  });

  return {
    log: async (entry) => {
      const { level, message, meta } = entry;

      // Log to pino (console/file)
      const logData = {
        msg: message,
        ...meta,
      };

      let pinoError: Error | null = null;
      try {
        switch (level) {
          case "debug":
            pinoLogger.debug(logData);
            break;
          case "info":
            pinoLogger.info(logData);
            break;
          case "warn":
            pinoLogger.warn(logData);
            break;
          case "error":
            pinoLogger.error(logData);
            break;
        }
      } catch (err) {
        // Capture pino error - will fail the pipeline after database write
        pinoError = err instanceof Error ? err : new Error(String(err));
        const errorMsg = pinoError.message;
        console.error(`[Pipeline Logger Error] ${errorMsg}`);
        console.log(`[${level.toUpperCase()}] ${message}`, meta || {});
      }

      // Always write to database (even if pino failed)
      await appendRunLog({
        runId,
        level,
        message,
        meta,
      });

      // Broadcast to any connected SSE clients
      broadcastLog({
        runId,
        level,
        message,
        meta,
        timestamp: new Date().toISOString(),
      });

      // If pino failed, throw error to fail the pipeline
      if (pinoError) {
        throw new Error(`Pino logger error: ${pinoError.message}`);
      }
    },
  };
}

