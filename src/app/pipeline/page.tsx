"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Upload,
  Play,
  RefreshCw,
  FileSpreadsheet,
  X,
  Terminal,
  RotateCw,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardAction,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type PresignResponse = {
  assetId: number;
  uploadUrl: string;
  objectKey: string;
  error?: string;
  message?: string;
  duplicateAssets?: Array<{
    id: number;
    originalName: string;
    sizeBytes: number;
    createdAt: string;
  }>;
};
type CreateRunResponse = { runId: number; error?: string };

type LogEntry = {
  runId: number;
  level: "debug" | "info" | "warn" | "error";
  message: string;
  meta?: Record<string, unknown>;
  timestamp: string;
};

function StatusBadge({ status }: { status: string }) {
  const variant =
    status === "succeeded"
      ? "default"
      : status === "failed" || status === "deleted"
      ? "destructive"
      : status === "running"
      ? "secondary"
      : "outline";
  return <Badge variant={variant}>{status}</Badge>;
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function PipelinePage() {
  const [file, setFile] = useState<File | null>(null);
  const [assetId, setAssetId] = useState<number | null>(null);
  const [orgType, setOrgType] = useState<
    "nhs" | "council" | "government_department" | null
  >(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const [runId, setRunId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runs, setRuns] = useState<any[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const limit = 20;

  const [isDragging, setIsDragging] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [streamStatus, setStreamStatus] = useState<
    "idle" | "connected" | "complete"
  >("idle");
  const [calculatingChecksum, setCalculatingChecksum] = useState(false);
  const [checksumProgress, setChecksumProgress] = useState<number | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState<{
    checksum: string;
    duplicateAssets: Array<{
      id: number;
      originalName: string;
      sizeBytes: number;
      createdAt: string;
    }>;
  } | null>(null);
  const [retryingRunId, setRetryingRunId] = useState<number | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  const canUpload = useMemo(
    () => !!file && !uploading && !calculatingChecksum,
    [file, uploading, calculatingChecksum]
  );
  const canRun = useMemo(
    () => !!assetId && !!orgType && !running,
    [assetId, orgType, running]
  );

  async function refreshRuns(targetPage = page) {
    const offset = (targetPage - 1) * limit;
    const resp = await fetch(`/api/pipeline/runs?limit=${limit}&offset=${offset}`);
    const data = await resp.json();
    setRuns(data.runs ?? []);
    setTotalCount(data.totalCount ?? 0);
  }

  useEffect(() => {
    void refreshRuns();
  }, [page]);

  // Auto-scroll logs to bottom
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  // Connect to SSE for log streaming when runId changes
  useEffect(() => {
    if (!runId) return;

    // Clean up previous connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    setLogs([]);
    setStreamStatus("idle");

    const es = new EventSource(`/api/pipeline/runs/${runId}/logs/stream`);
    eventSourceRef.current = es;

    console.log(`[SSE] Connecting to run ${runId}...`);

    es.addEventListener("connected", (e) => {
      console.log(`[SSE] Connected to run ${runId}`, e);
      setStreamStatus("connected");
    });

    es.addEventListener("log", (e) => {
      try {
        const entry = JSON.parse(e.data) as LogEntry;
        console.log(`[SSE] Received log:`, entry.message);
        setLogs((prev) => [...prev, entry]);
      } catch (err) {
        console.error(`[SSE] Failed to parse log data:`, e.data, err);
      }
    });

    es.addEventListener("complete", (e) => {
      console.log(`[SSE] Run complete:`, e.data);
      const data = JSON.parse(e.data) as { status: string };
      setStreamStatus("complete");
      es.close();
      // Refresh runs list to update status
      void refreshRuns(page);
    });

    es.onerror = (e) => {
      console.error(`[SSE] EventSource error:`, e);
      setStreamStatus("complete");
      es.close();
    };

    return () => {
      es.close();
    };
  }, [runId]);

  const handleFile = useCallback((f: File | null) => {
    if (f && (f.name.endsWith(".xlsx") || f.name.endsWith(".xls"))) {
      setFile(f);
      setAssetId(null);
      setRunId(null);
      setError(null);
      setDuplicateWarning(null);
    } else if (f) {
      setError("Please select an Excel file (.xlsx or .xls)");
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const droppedFile = e.dataTransfer.files[0];
      handleFile(droppedFile);
    },
    [handleFile]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  async function calculateFileChecksum(file: File): Promise<string> {
    setCalculatingChecksum(true);
    setChecksumProgress(0);

    try {
      // Read file in chunks to show progress
      const chunkSize = 1024 * 1024; // 1MB chunks
      const totalChunks = Math.ceil(file.size / chunkSize);
      const chunks: Uint8Array[] = [];

      for (let i = 0; i < totalChunks; i++) {
        const start = i * chunkSize;
        const end = Math.min(start + chunkSize, file.size);
        const chunk = file.slice(start, end);
        const arrayBuffer = await chunk.arrayBuffer();
        chunks.push(new Uint8Array(arrayBuffer));

        // Update progress
        setChecksumProgress(Math.round(((i + 1) / totalChunks) * 100));
      }

      // Combine chunks
      const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
      const combined = new Uint8Array(totalLength);
      let position = 0;
      for (const chunk of chunks) {
        combined.set(chunk, position);
        position += chunk.length;
      }

      // Calculate SHA-256 hash
      const hashBuffer = await crypto.subtle.digest("SHA-256", combined.buffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const checksum = hashArray
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      setChecksumProgress(100);
      return checksum;
    } finally {
      setCalculatingChecksum(false);
      // Reset progress after a brief delay so user can see 100%
      setTimeout(() => setChecksumProgress(null), 500);
    }
  }

  async function uploadSelected(force = false) {
    if (!file) return;
    setError(null);
    setRunId(null);
    setAssetId(null);
    setDuplicateWarning(null);
    setUploadProgress(0);

    try {
      // Calculate checksum first
      const checksum = await calculateFileChecksum(file);

      setUploading(true);
      const presignResp = await fetch("/api/pipeline/assets/presign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          originalName: file.name,
          contentType: file.type || "application/octet-stream",
          sizeBytes: file.size,
          checksum,
          force,
        }),
      });
      const presignData = (await presignResp.json()) as PresignResponse;

      if (
        presignResp.status === 409 &&
        presignData.error === "duplicate_checksum"
      ) {
        // Duplicate checksum detected - show warning
        setUploading(false);
        setUploadProgress(null);
        setDuplicateWarning({
          checksum,
          duplicateAssets: presignData.duplicateAssets || [],
        });
        return;
      }

      if (!presignResp.ok) {
        throw new Error(
          presignData.error || presignData.message || "Failed to presign upload"
        );
      }

      // Use XMLHttpRequest for progress tracking
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", presignData.uploadUrl);
        if (file.type) {
          xhr.setRequestHeader("Content-Type", file.type);
        }

        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            const percentComplete = Math.round(
              (event.loaded / event.total) * 100
            );
            setUploadProgress(percentComplete);
          }
        };

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve();
          } else {
            reject(new Error(`Upload failed (${xhr.status})`));
          }
        };

        xhr.onerror = () => reject(new Error("Network error during upload"));
        xhr.send(file);
      });

      setUploadProgress(100);
      setAssetId(presignData.assetId);
      if (page !== 1) {
        setPage(1);
      } else {
        await refreshRuns(1);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setUploadProgress(null);
    } finally {
      setUploading(false);
      // Keep progress at 100% for a moment then clear
      setTimeout(() => setUploadProgress(null), 1000);
    }
  }

  async function startRun(assetIdToUse?: number) {
    const targetAssetId = assetIdToUse ?? assetId;
    if (!targetAssetId) return;
    setError(null);
    setRunning(true);
    setRunId(null);
    try {
      const resp = await fetch("/api/pipeline/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          assetId: targetAssetId, 
          dryRun: false,
          orgType
        }),
      });
      const data = (await resp.json()) as CreateRunResponse;
      if (!resp.ok) {
        throw new Error(data.error || "Failed to start run");
      }
      setRunId(data.runId);
      
      // Clear upload UI state after successful run start
      setFile(null);
      setAssetId(null);
      setOrgType(null);
      setDuplicateWarning(null);
      
      if (page !== 1) {
        setPage(1);
      } else {
        await refreshRuns(1);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  async function retryRun(run: { id: number; assetId: number }) {
    setRetryingRunId(run.id);
    setError(null);
    try {
      const resp = await fetch("/api/pipeline/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetId: run.assetId, dryRun: false }),
      });
      const data = (await resp.json()) as CreateRunResponse;
      if (!resp.ok) {
        throw new Error(data.error || "Failed to retry run");
      }
      setRunId(data.runId);
      if (page !== 1) {
        setPage(1);
      } else {
        await refreshRuns(1);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRetryingRunId(null);
    }
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Data Pipeline</h1>
        <p className="text-sm text-muted-foreground">
          Upload an Excel workbook to object storage and run the import
          pipeline.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Upload & Import</CardTitle>
          <CardDescription>
            Drag and drop an Excel file or click to browse
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            className={cn(
              "relative rounded-lg border-2 border-dashed transition-colors",
              isDragging
                ? "border-primary bg-primary/5"
                : "border-muted-foreground/25 hover:border-muted-foreground/50",
              file && "border-solid border-muted"
            )}
          >
            {!file ? (
              <label className="flex flex-col items-center justify-center gap-3 p-8 cursor-pointer">
                <div
                  className={cn(
                    "rounded-full p-3 transition-colors",
                    isDragging ? "bg-primary/10" : "bg-muted"
                  )}
                >
                  <Upload
                    className={cn(
                      "size-6",
                      isDragging ? "text-primary" : "text-muted-foreground"
                    )}
                  />
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium">
                    {isDragging
                      ? "Drop file here"
                      : "Drag & drop your Excel file"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    or click to browse • .xlsx, .xls
                  </p>
                </div>
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
              </label>
            ) : (
              <div className="flex items-center gap-3 p-4">
                <div className="rounded-lg bg-emerald-500/10 p-2">
                  <FileSpreadsheet className="size-6 text-emerald-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{file.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatFileSize(file.size)}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => {
                    setFile(null);
                    setAssetId(null);
                    setDuplicateWarning(null);
                  }}
                  className="shrink-0"
                >
                  <X className="size-4" />
                </Button>
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-3 flex-wrap">
            <Button disabled={!canUpload} onClick={() => void uploadSelected()}>
              <Upload className="size-4" />
              {calculatingChecksum
                ? `Calculating... ${
                    checksumProgress !== null ? `${checksumProgress}%` : ""
                  }`
                : uploading
                ? `Uploading... ${
                    uploadProgress !== null ? `${uploadProgress}%` : ""
                  }`
                : "Upload"}
            </Button>

            {calculatingChecksum && checksumProgress !== null && (
              <div className="flex-1 min-w-[200px] max-w-xs space-y-1">
                <div className="flex justify-between text-[10px] text-muted-foreground uppercase font-medium">
                  <span>Checksum</span>
                  <span>{checksumProgress}%</span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all duration-300"
                    style={{ width: `${checksumProgress}%` }}
                  />
                </div>
              </div>
            )}

            {uploading && uploadProgress !== null && (
              <div className="flex-1 min-w-[200px] max-w-xs space-y-1">
                <div className="flex justify-between text-[10px] text-muted-foreground uppercase font-medium">
                  <span>Uploading</span>
                  <span>{uploadProgress}%</span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500 transition-all duration-300"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              </div>
            )}

            {assetId && (
              <>
                <span className="text-sm text-muted-foreground">
                  Asset ID:{" "}
                  <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                    {assetId}
                  </code>
                </span>
              </>
            )}

            {runId && (
              <span className="text-sm text-muted-foreground">
                →{" "}
                <Link
                  className="font-medium text-primary hover:underline"
                  href={`/pipeline/runs/${runId}`}
                >
                  Run #{runId}
                </Link>
              </span>
            )}
          </div>

          {/* Organization Type Selection - Only after assetId is present */}
          {assetId && (
            <div className="space-y-4 rounded-lg border bg-muted/30 p-4 animate-in fade-in slide-in-from-top-2 duration-300">
              <div className="space-y-1">
                <label className="text-sm font-semibold">Select Organization Type</label>
                <p className="text-xs text-muted-foreground">
                  Choose the type of organization for this data import.
                </p>
              </div>
              <div className="flex items-center gap-6">
                <label className="flex items-center gap-2 cursor-pointer group">
                  <div className={cn(
                    "flex h-4 w-4 items-center justify-center rounded-full border border-primary transition-colors",
                    orgType === "nhs" ? "bg-primary" : "bg-background"
                  )}>
                    {orgType === "nhs" && <div className="h-1.5 w-1.5 rounded-full bg-primary-foreground" />}
                  </div>
                  <input
                    type="radio"
                    name="orgType"
                    className="sr-only"
                    checked={orgType === "nhs"}
                    onChange={() => setOrgType("nhs")}
                  />
                  <span className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                    NHS Organisation
                  </span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer group">
                  <div className={cn(
                    "flex h-4 w-4 items-center justify-center rounded-full border border-primary transition-colors",
                    orgType === "council" ? "bg-primary" : "bg-background"
                  )}>
                    {orgType === "council" && <div className="h-1.5 w-1.5 rounded-full bg-primary-foreground" />}
                  </div>
                  <input
                    type="radio"
                    name="orgType"
                    className="sr-only"
                    checked={orgType === "council"}
                    onChange={() => setOrgType("council")}
                  />
                  <span className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                    Local Authority (Council)
                  </span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer group">
                  <div
                    className={cn(
                      "flex h-4 w-4 items-center justify-center rounded-full border border-primary transition-colors",
                      orgType === "government_department"
                        ? "bg-primary"
                        : "bg-background"
                    )}
                  >
                    {orgType === "government_department" && (
                      <div className="h-1.5 w-1.5 rounded-full bg-primary-foreground" />
                    )}
                  </div>
                  <input
                    type="radio"
                    name="orgType"
                    className="sr-only"
                    checked={orgType === "government_department"}
                    onChange={() => setOrgType("government_department")}
                  />
                  <span className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                    Government Department
                  </span>
                </label>
              </div>

              <div className="pt-2">
                <Button 
                  disabled={!canRun} 
                  onClick={() => void startRun()}
                  className="w-full sm:w-auto"
                >
                  <Play className="size-4" />
                  {running ? "Starting…" : "Run Import"}
                </Button>
                {!orgType && (
                  <p className="text-[10px] text-destructive mt-2 font-medium">
                    * Please select an organization type to proceed with the import.
                  </p>
                )}
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-md bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {/* Duplicate checksum warning */}
          {duplicateWarning && (
            <Card className="border-yellow-500/50 bg-yellow-500/5">
              <CardHeader>
                <CardTitle className="text-yellow-600">
                  Duplicate File Detected
                </CardTitle>
                <CardDescription>
                  A file with the same checksum already exists in the system.
                  This might be a duplicate upload.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <p className="text-sm font-medium">
                    Existing assets with this checksum:
                  </p>
                  <div className="space-y-2">
                    {duplicateWarning.duplicateAssets.map((asset) => (
                      <div
                        key={asset.id}
                        className="rounded-md bg-muted/50 px-3 py-2 text-sm"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-medium">
                            {asset.originalName}
                          </span>
                          <span className="text-muted-foreground text-xs">
                            Asset{" "}
                            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                              #{asset.id}
                            </code>
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          {formatFileSize(asset.sizeBytes)} •{" "}
                          {new Date(asset.createdAt).toLocaleString()}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-3 flex-wrap">
                  <Button
                    onClick={() => {
                      const firstAssetId = duplicateWarning.duplicateAssets[0]?.id;
                      if (firstAssetId) {
                        setDuplicateWarning(null);
                        setAssetId(firstAssetId);
                        void startRun(firstAssetId);
                      }
                    }}
                    variant="default"
                  >
                    <Play className="size-4" />
                    Use Existing Asset & Run Import
                  </Button>
                  <Button
                    onClick={() => {
                      setDuplicateWarning(null);
                      void uploadSelected(true);
                    }}
                    variant="secondary"
                  >
                    Continue Anyway
                  </Button>
                  <Button
                    onClick={() => setDuplicateWarning(null)}
                    variant="outline"
                  >
                    Cancel
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Live Log Viewer */}
          {runId && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm">
                <Terminal className="size-4 text-muted-foreground" />
                <span className="font-medium">Pipeline Logs</span>
                {streamStatus === "connected" && (
                  <Badge variant="secondary" className="text-xs">
                    <span className="mr-1.5 size-2 rounded-full bg-green-500 animate-pulse inline-block" />
                    Live
                  </Badge>
                )}
                {streamStatus === "complete" && (
                  <Badge variant="outline" className="text-xs">
                    Complete
                  </Badge>
                )}
              </div>
              <div className="rounded-md bg-zinc-950 border border-zinc-800 p-3 font-mono text-xs max-h-80 overflow-y-auto">
                {logs.length === 0 ? (
                  <div className="text-zinc-500">Waiting for logs...</div>
                ) : (
                  logs.map((log, i) => (
                    <div key={i} className="leading-relaxed">
                      <span className="text-zinc-600">
                        {new Date(log.timestamp).toLocaleTimeString()}
                      </span>{" "}
                      <span
                        className={cn(
                          "uppercase font-semibold",
                          log.level === "error" && "text-red-400",
                          log.level === "warn" && "text-yellow-400",
                          log.level === "info" && "text-blue-400",
                          log.level === "debug" && "text-zinc-500"
                        )}
                      >
                        [{log.level}]
                      </span>{" "}
                      <span className="text-zinc-200">{log.message}</span>
                      {log.meta && Object.keys(log.meta).length > 0 && (
                        <span className="text-zinc-500 ml-2">
                          {JSON.stringify(log.meta)}
                        </span>
                      )}
                    </div>
                  ))
                )}
                <div ref={logsEndRef} />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent Runs</CardTitle>
          <CardDescription>History of pipeline executions</CardDescription>
          <CardAction>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void refreshRuns(page)}
            >
              <RefreshCw className="size-4" />
              Refresh
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Run</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Org Type</TableHead>
                <TableHead>Filename</TableHead>
                <TableHead>Asset</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="w-[100px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map((r) => {
                const isMatchSuppliers = r.fromStageId === "matchSuppliers";
                const isImport = r.fromStageId?.startsWith("import") || !r.fromStageId;
                const runType = isMatchSuppliers 
                  ? "Match Suppliers" 
                  : isImport 
                  ? "Import Spending" 
                  : r.fromStageId || "Unknown";

                const orgTypeLabel = r.orgType === "nhs" 
                  ? "NHS Organisation"
                  : r.orgType === "council"
                  ? "Local Authority"
                  : r.orgType === "government_department"
                  ? "Government Department"
                  : r.orgType || "—";

                return (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Link
                        className="font-medium text-primary hover:underline"
                        href={`/pipeline/runs/${r.id}`}
                      >
                        #{r.id}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-normal">
                        {runType}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="font-normal">
                        {orgTypeLabel}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[300px] truncate">
                      {r.assetOriginalName || (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {r.assetId ? (
                        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                          {r.assetId}
                        </code>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={r.status} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {r.createdAt ? new Date(r.createdAt).toLocaleString() : ""}
                    </TableCell>
                    <TableCell>
                      {r.status === "failed" && r.assetId && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void retryRun(r)}
                          disabled={retryingRunId === r.id}
                          className="h-8"
                        >
                          <RotateCw
                            className={cn(
                              "size-4",
                              retryingRunId === r.id && "animate-spin"
                            )}
                          />
                          <span className="sr-only">Retry</span>
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {runs.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="h-24 text-center text-muted-foreground"
                  >
                    No runs yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>

          {totalCount > limit && (
            <div className="flex items-center justify-between px-2 py-4 border-t">
              <div className="text-sm text-muted-foreground">
                Showing {Math.min(totalCount, (page - 1) * limit + 1)} to{" "}
                {Math.min(totalCount, page * limit)} of {totalCount} runs
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                >
                  <ChevronLeft className="size-4 mr-1" />
                  Previous
                </Button>
                <div className="text-sm font-medium">
                  Page {page} of {Math.ceil(totalCount / limit)}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => p + 1)}
                  disabled={page >= Math.ceil(totalCount / limit)}
                >
                  Next
                  <ChevronRight className="size-4 ml-1" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
