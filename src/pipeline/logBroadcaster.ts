import type { PipelineLogLevel } from "./types";

export type LogEntry = {
  runId: number;
  level: PipelineLogLevel;
  message: string;
  meta?: Record<string, unknown>;
  timestamp: string;
};

type Subscriber = (entry: LogEntry) => void;

// Map of runId -> Set of subscribers
const subscribers = new Map<number, Set<Subscriber>>();

// Buffer recent logs per run so late-connecting clients can catch up
const logBuffer = new Map<number, LogEntry[]>();
const MAX_BUFFER_SIZE = 500;
const BUFFER_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Track when buffers were last updated for cleanup
const bufferTimestamps = new Map<number, number>();

export function subscribeToRunLogs(runId: number, callback: Subscriber): () => void {
  if (!subscribers.has(runId)) {
    subscribers.set(runId, new Set());
  }
  subscribers.get(runId)!.add(callback);

  // Return unsubscribe function
  return () => {
    const subs = subscribers.get(runId);
    if (subs) {
      subs.delete(callback);
      if (subs.size === 0) {
        subscribers.delete(runId);
      }
    }
  };
}

/**
 * Get buffered logs for a run (for late-connecting clients)
 */
export function getBufferedLogs(runId: number): LogEntry[] {
  return logBuffer.get(runId) ?? [];
}

export function broadcastLog(entry: LogEntry) {
  // Add to buffer
  if (!logBuffer.has(entry.runId)) {
    logBuffer.set(entry.runId, []);
  }
  const buffer = logBuffer.get(entry.runId)!;
  buffer.push(entry);
  bufferTimestamps.set(entry.runId, Date.now());
  
  // Trim buffer if too large
  if (buffer.length > MAX_BUFFER_SIZE) {
    buffer.splice(0, buffer.length - MAX_BUFFER_SIZE);
  }

  // Broadcast to live subscribers
  const subs = subscribers.get(entry.runId);
  if (subs) {
    for (const callback of subs) {
      try {
        callback(entry);
      } catch {
        // Ignore subscriber errors
      }
    }
  }

  // Cleanup old buffers periodically
  cleanupOldBuffers();
}

function cleanupOldBuffers() {
  const now = Date.now();
  for (const [runId, timestamp] of bufferTimestamps) {
    if (now - timestamp > BUFFER_TTL_MS) {
      logBuffer.delete(runId);
      bufferTimestamps.delete(runId);
    }
  }
}

/**
 * Clear buffer for a run (call when run completes)
 */
export function clearBuffer(runId: number) {
  // Keep buffer for a short time after completion so clients can catch up
  setTimeout(() => {
    logBuffer.delete(runId);
    bufferTimestamps.delete(runId);
  }, 30000); // 30 seconds
}

export function hasSubscribers(runId: number): boolean {
  const subs = subscribers.get(runId);
  return subs !== undefined && subs.size > 0;
}
