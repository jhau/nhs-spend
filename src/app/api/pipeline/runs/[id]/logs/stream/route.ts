import {
  subscribeToRunLogs,
  getBufferedLogs,
  type LogEntry,
} from "@/pipeline/logBroadcaster";
import { getRun, getRunLogs } from "@/pipeline/pipelineDb";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const runId = Number(id);

  if (!Number.isInteger(runId) || runId <= 0) {
    return new Response("Invalid run ID", { status: 400 });
  }

  // Check run exists
  const run = await getRun(runId);
  if (!run) {
    return new Response("Run not found", { status: 404 });
  }

  const encoder = new TextEncoder();

  let unsubscribe: (() => void) | null = null;
  let pingInterval: NodeJS.Timeout | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (event: string, data: any) => {
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
          );
        } catch (e) {
          // Stream might be closed
        }
      };

      // Send initial connection event
      sendEvent("connected", { runId });
      console.log(`[SSE] Client connected for run ${runId}`);

      // If run already finished, send logs from DB and complete
      if (run.status === "succeeded" || run.status === "failed") {
        console.log(`[SSE] Run ${runId} already finished with status ${run.status}, sending DB logs`);
        const dbLogs = await getRunLogs(runId, 500);
        for (const log of dbLogs) {
          sendEvent("log", {
            runId,
            level: log.level as LogEntry["level"],
            message: log.message,
            meta: log.meta ?? undefined,
            timestamp: log.ts.toISOString(),
          });
        }

        sendEvent("complete", { status: run.status });
        try {
          controller.close();
        } catch (e) {}
        return;
      }

      // Replay any buffered logs first
      const bufferedLogs = getBufferedLogs(runId);
      console.log(`[SSE] Replaying ${bufferedLogs.length} buffered logs for run ${runId}`);
      for (const entry of bufferedLogs) {
        sendEvent("log", entry);
      }

      const sentLogIds = new Set(
        bufferedLogs.map((l) => `${l.timestamp}-${l.message}`)
      );

      // Keep track of the interval so we can clear it
      pingInterval = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch (e) {
          if (pingInterval) clearInterval(pingInterval);
        }
      }, 15000);

      // Subscribe to live log updates
      console.log(`[SSE] Subscribing to live logs for run ${runId}`);
      unsubscribe = subscribeToRunLogs(runId, (entry: LogEntry) => {
        const logId = `${entry.timestamp}-${entry.message}`;
        if (sentLogIds.has(logId)) return;
        sentLogIds.add(logId);

        console.log(`[SSE] Sending live log to run ${runId}: ${entry.message.slice(0, 50)}...`);
        sendEvent("log", entry);

        if (
          entry.message === "Pipeline run succeeded" ||
          entry.message === "Pipeline run failed"
        ) {
          sendEvent("complete", {
            status: entry.message.includes("succeeded") ? "succeeded" : "failed",
          });
          if (pingInterval) clearInterval(pingInterval);
          try {
            controller.close();
          } catch (e) {}
          if (unsubscribe) unsubscribe();
        }
      });
    },
    cancel() {
      if (pingInterval) clearInterval(pingInterval);
      if (unsubscribe) unsubscribe();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
