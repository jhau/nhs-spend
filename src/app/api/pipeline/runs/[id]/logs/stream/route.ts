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

  const stream = new ReadableStream({
    async start(controller) {
      // Send initial connection event
      controller.enqueue(
        encoder.encode(`event: connected\ndata: ${JSON.stringify({ runId })}\n\n`)
      );

      // If run already finished, send logs from DB and complete
      if (run.status === "succeeded" || run.status === "failed") {
        // Get logs from database
        const dbLogs = await getRunLogs(runId, 500);
        for (const log of dbLogs) {
          const entry: LogEntry = {
            runId,
            level: log.level as LogEntry["level"],
            message: log.message,
            meta: log.meta ?? undefined,
            timestamp: log.ts.toISOString(),
          };
          controller.enqueue(
            encoder.encode(`event: log\ndata: ${JSON.stringify(entry)}\n\n`)
          );
        }

        controller.enqueue(
          encoder.encode(
            `event: complete\ndata: ${JSON.stringify({ status: run.status })}\n\n`
          )
        );
        controller.close();
        return;
      }

      // Replay any buffered logs first (for late-connecting clients)
      const bufferedLogs = getBufferedLogs(runId);
      for (const entry of bufferedLogs) {
        try {
          controller.enqueue(
            encoder.encode(`event: log\ndata: ${JSON.stringify(entry)}\n\n`)
          );
        } catch {
          // Stream closed
          return;
        }
      }

      // Track which logs we've already sent to avoid duplicates
      const sentLogIds = new Set(
        bufferedLogs.map((l) => `${l.timestamp}-${l.message}`)
      );

      // Subscribe to live log updates
      const unsubscribe = subscribeToRunLogs(runId, (entry: LogEntry) => {
        const logId = `${entry.timestamp}-${entry.message}`;
        if (sentLogIds.has(logId)) {
          return; // Skip duplicates
        }
        sentLogIds.add(logId);

        try {
          controller.enqueue(
            encoder.encode(`event: log\ndata: ${JSON.stringify(entry)}\n\n`)
          );

          // Check if this is a completion message
          if (
            entry.message === "Pipeline run succeeded" ||
            entry.message === "Pipeline run failed"
          ) {
            controller.enqueue(
              encoder.encode(
                `event: complete\ndata: ${JSON.stringify({
                  status: entry.message.includes("succeeded") ? "succeeded" : "failed",
                })}\n\n`
              )
            );
            controller.close();
            unsubscribe();
          }
        } catch {
          // Stream closed by client
          unsubscribe();
        }
      });

      // Handle client disconnect - cleanup is handled when controller.enqueue throws
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
