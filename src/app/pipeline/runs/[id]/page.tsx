"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  RefreshCw,
  Loader2,
  FileSpreadsheet,
  Building2,
  Users,
  Receipt,
  AlertTriangle,
  Clock,
  CheckCircle2,
  XCircle,
  Trash2,
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
import { CompaniesHouseSearch } from "@/components/CompaniesHouseSearch";

type RunDetailResponse = {
  run?: {
    id: number;
    assetId: number;
    status: string;
    dryRun: boolean;
    trigger: string;
    fromStageId?: string | null;
    toStageId?: string | null;
    createdBy?: string | null;
    startedAt?: string | null;
    finishedAt?: string | null;
    createdAt: string;
  };
  asset?: {
    id: number;
    originalName: string;
    objectKey: string;
    sizeBytes: number;
    createdAt: string;
  };
  stages?: Array<{
    id: number;
    stageId: string;
    status: string;
    startedAt?: string | null;
    finishedAt?: string | null;
    metrics?: Record<string, unknown> | null;
    error?: string | null;
  }>;
  logs?: Array<{
    id: number;
    ts: string;
    level: string;
    message: string;
    meta?: Record<string, unknown> | null;
  }>;
  skippedRows?: Array<{
    id: number;
    sheetName: string;
    rowNumber: number;
    reason: string;
    rawData?: any[] | null;
  }>;
  skippedRowsCount?: number;
  skippedRowsLimit?: number;
  skippedRowsOffset?: number;
  suppliers?: Array<{
    id: number;
    name: string;
    matchStatus: string;
    matchConfidence: string | null;
    entityId: number | null;
    entityName: string | null;
    entityType: string | null;
    companyNumber: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  suppliersCount?: number;
  suppliersLimit?: number;
  suppliersOffset?: number;
  dateRange?: {
    minDate: string;
    maxDate: string;
  } | null;
  error?: string;
};

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

function formatDuration(startedAt?: string | null, finishedAt?: string | null) {
  if (!startedAt) return null;
  const start = new Date(startedAt).getTime();
  const end = finishedAt ? new Date(finishedAt).getTime() : Date.now();
  const durationMs = end - start;

  if (durationMs < 1000) return `${durationMs}ms`;
  if (durationMs < 60000) return `${(durationMs / 1000).toFixed(1)}s`;
  return `${(durationMs / 60000).toFixed(1)}m`;
}

function formatNumber(n: unknown): string {
  if (typeof n !== "number") return String(n ?? 0);
  return n.toLocaleString();
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type Metrics = {
  trustsInserted?: number;
  trustsUpdated?: number;
  trustsCreatedWithoutMetadata?: number;
  councilsInserted?: number;
  councilsUpdated?: number;
  suppliersInserted?: number;
  sheetsProcessed?: number;
  paymentsInserted?: number;
  paymentsSkipped?: number;
  skippedReasons?: Record<string, number>;
  dryRun?: boolean;
  councilsDiscovered?: number;
  suppliersDiscovered?: number;
  // Match stage metrics
  totalProcessed?: number;
  matchedCount?: number;
  noMatchCount?: number;
  skippedCount?: number;
  errorCount?: number;
  [key: string]: unknown;
};

function MetricsDisplay({ metrics }: { metrics: Metrics | null | undefined }) {
  if (!metrics) return null;

  if (metrics.dryRun) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/10 p-4">
          <p className="text-sm text-yellow-600 dark:text-yellow-400 font-medium">
            Dry Run - No changes were made to the database
          </p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="rounded-lg border bg-card p-4 space-y-2">
            <p className="text-2xl font-bold tracking-tight">
              {formatNumber(metrics.sheets ?? metrics.sheetsProcessed)}
            </p>
            <p className="text-xs text-muted-foreground">Sheets to Process</p>
          </div>
          <div className="rounded-lg border bg-card p-4 space-y-2">
            <p className="text-2xl font-bold tracking-tight">
              {formatNumber(metrics.councilsDiscovered)}
            </p>
            <p className="text-xs text-muted-foreground">Councils Discovered</p>
          </div>
          <div className="rounded-lg border bg-card p-4 space-y-2">
            <p className="text-2xl font-bold tracking-tight">
              {formatNumber(metrics.suppliersDiscovered)}
            </p>
            <p className="text-xs text-muted-foreground">Suppliers Discovered</p>
          </div>
        </div>
      </div>
    );
  }

  const stats = [
    {
      label: "Payments Imported",
      value: formatNumber(metrics.paymentsInserted),
      icon: Receipt,
      color: "text-emerald-600",
      bgColor: "bg-emerald-500/10",
      hidden: metrics.paymentsInserted === undefined,
    },
    {
      label: "Sheets Processed",
      value: formatNumber(metrics.sheetsProcessed),
      icon: FileSpreadsheet,
      color: "text-blue-600",
      bgColor: "bg-blue-500/10",
      hidden: metrics.sheetsProcessed === undefined,
    },
    {
      label: "Suppliers Discovered",
      value: formatNumber(metrics.suppliersInserted),
      icon: Users,
      color: "text-orange-600",
      bgColor: "bg-orange-500/10",
      hidden: metrics.suppliersInserted === undefined,
    },
    {
      label: "Trusts Added",
      value: formatNumber(
        (metrics.trustsInserted ?? 0) +
          (metrics.trustsCreatedWithoutMetadata ?? 0)
      ),
      icon: Building2,
      color: "text-violet-600",
      bgColor: "bg-violet-500/10",
      hidden: !metrics.trustsInserted && !metrics.trustsCreatedWithoutMetadata,
    },
    {
      label: "Trusts Updated",
      value: formatNumber(metrics.trustsUpdated),
      icon: Building2,
      color: "text-indigo-600",
      bgColor: "bg-indigo-500/10",
      hidden: !metrics.trustsUpdated,
    },
    {
      label: "Councils Added",
      value: formatNumber(metrics.councilsInserted),
      icon: Building2,
      color: "text-pink-600",
      bgColor: "bg-pink-500/10",
      hidden: !metrics.councilsInserted,
    },
    {
      label: "Councils Updated",
      value: formatNumber(metrics.councilsUpdated),
      icon: Building2,
      color: "text-rose-600",
      bgColor: "bg-rose-500/10",
      hidden: !metrics.councilsUpdated,
    },
    {
      label: "Rows Skipped",
      value: formatNumber(metrics.paymentsSkipped),
      icon: AlertTriangle,
      color: "text-amber-600",
      bgColor: "bg-amber-500/10",
      hidden: !metrics.paymentsSkipped,
    },
    // Match stage specific
    {
      label: "Suppliers Matched",
      value: formatNumber(metrics.matchedCount),
      icon: CheckCircle2,
      color: "text-emerald-600",
      bgColor: "bg-emerald-500/10",
      hidden: metrics.matchedCount === undefined,
    },
    {
      label: "No Match Found",
      value: formatNumber(metrics.noMatchCount),
      icon: XCircle,
      color: "text-destructive",
      bgColor: "bg-destructive/10",
      hidden: metrics.noMatchCount === undefined,
    },
    {
      label: "Matching Errors",
      value: formatNumber(metrics.errorCount),
      icon: AlertTriangle,
      color: "text-red-600",
      bgColor: "bg-red-500/10",
      hidden: !metrics.errorCount,
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8 gap-4">
      {stats
        .filter((s) => !s.hidden)
        .map((stat) => (
          <div
            key={stat.label}
            className="rounded-lg border bg-card p-4 space-y-2"
          >
            <div className="flex items-center gap-2">
              <div className={cn("rounded-md p-1.5", stat.bgColor)}>
                <stat.icon className={cn("size-4", stat.color)} />
              </div>
            </div>
            <div>
              <p className="text-2xl font-bold tracking-tight">{stat.value}</p>
              <p className="text-xs text-muted-foreground">{stat.label}</p>
            </div>
          </div>
        ))}
    </div>
  );
}

function SkippedRowsTable({
  rows,
  totalCount,
  offset,
  limit,
  onPageChange,
}: {
  rows?: RunDetailResponse["skippedRows"];
  totalCount?: number;
  offset: number;
  limit: number;
  onPageChange: (newOffset: number) => void;
}) {
  if (!rows || rows.length === 0) return null;

  const total = totalCount ?? 0;
  const start = offset + 1;
  const end = Math.min(offset + limit, total);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="size-5 text-amber-500" />
            Skipped Row Details
          </CardTitle>
          <CardDescription>
            Showing {start}-{end} of {total.toLocaleString()} skipped rows to
            help identify data issues.
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            disabled={offset === 0}
            onClick={() => onPageChange(Math.max(0, offset - limit))}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            disabled={offset + limit >= total}
            onClick={() => onPageChange(offset + limit)}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Sheet</TableHead>
              <TableHead>Row</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Raw Data (Trust, Date, Supplier, Amount)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-medium">{row.sheetName}</TableCell>
                <TableCell>{row.rowNumber}</TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className="text-amber-600 bg-amber-50"
                  >
                    {row.reason}
                  </Badge>
                </TableCell>
                <TableCell className="max-w-md truncate font-mono text-[10px] text-muted-foreground">
                  {row.rawData ? row.rawData.slice(0, 4).join(" | ") : "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function SuppliersTable({
  suppliers,
  totalCount,
  offset,
  limit,
  onPageChange,
  onLinked,
}: {
  suppliers?: RunDetailResponse["suppliers"];
  totalCount?: number;
  offset: number;
  limit: number;
  onPageChange: (newOffset: number) => void;
  onLinked?: () => void;
}) {
  if (!suppliers || suppliers.length === 0) return null;

  const total = totalCount ?? 0;
  const start = offset + 1;
  const end = Math.min(offset + limit, total);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2">
            <Users className="size-5 text-blue-500" />
            Suppliers in this Run
          </CardTitle>
          <CardDescription>
            Showing {start}-{end} of {total.toLocaleString()} suppliers
            discovered or updated.
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            disabled={offset === 0}
            onClick={() => onPageChange(Math.max(0, offset - limit))}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            disabled={offset + limit >= total}
            onClick={() => onPageChange(offset + limit)}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[300px]">Supplier Name</TableHead>
              <TableHead className="w-[120px]">Type</TableHead>
              <TableHead className="w-[120px]">Match Status</TableHead>
              <TableHead className="w-[200px]">Match Entity</TableHead>
              <TableHead className="w-[80px]">Confidence</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {suppliers.map((s) => (
              <TableRow key={s.id}>
                <TableCell className="font-medium w-[300px] max-w-[300px] break-words whitespace-normal leading-tight">
                  <Link
                    href={`/suppliers/${s.id}`}
                    className="text-primary hover:underline"
                  >
                    {s.name}
                  </Link>
                </TableCell>
                <TableCell className="w-[120px]">
                  {s.entityType ? (
                    <Badge variant="outline" className="capitalize">
                      {s.entityType.replace("_", " ")}
                    </Badge>
                  ) : (
                    <span className="text-muted-foreground text-xs">—</span>
                  )}
                </TableCell>
                <TableCell className="w-[120px]">
                  <Badge
                    variant={
                      s.matchStatus === "matched" ? "default" : "outline"
                    }
                    className={cn(
                      s.matchStatus === "matched" &&
                        "bg-emerald-500 hover:bg-emerald-600 text-white",
                      s.matchStatus === "no_match" &&
                        "text-destructive border-destructive"
                    )}
                  >
                    {s.matchStatus}
                  </Badge>
                </TableCell>
                <TableCell className="w-[200px] max-w-[200px]">
                  {s.entityName ? (
                    <div className="flex flex-col break-words whitespace-normal overflow-wrap-anywhere">
                      <span className="text-sm break-words whitespace-normal font-medium">
                        {s.entityName}
                      </span>
                      <span className="text-xs text-muted-foreground font-mono break-all whitespace-normal">
                        {s.entityType === "company" && s.companyNumber
                          ? s.companyNumber
                          : s.entityType?.replace("_", " ")}
                      </span>
                    </div>
                  ) : (
                    <CompaniesHouseSearch
                      supplierName={s.name}
                      supplierId={s.id}
                      onLinked={onLinked}
                      buttonText="Link"
                      buttonVariant="outline"
                      buttonSize="sm"
                    />
                  )}
                </TableCell>
                <TableCell className="w-[80px]">
                  {s.matchConfidence ? (
                    <span className="text-sm font-medium">
                      {(Number(s.matchConfidence) * 100).toFixed(0)}%
                    </span>
                  ) : (
                    "—"
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

export default function PipelineRunPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: runId } = use(params);
  const router = useRouter();
  const [data, setData] = useState<RunDetailResponse>({});
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [liveLogs, setLiveLogs] = useState<LogEntry[]>([]);
  const [streamStatus, setStreamStatus] = useState<
    "idle" | "connected" | "complete"
  >("idle");
  const [skippedOffset, setSkippedOffset] = useState(0);
  const [suppliersOffset, setSuppliersOffset] = useState(0);
  const skippedLimit = 50;
  const suppliersLimit = 50;
  const logsEndRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  async function fetchRun(
    sOffset = skippedOffset,
    supOffset = suppliersOffset
  ) {
    const resp = await fetch(
      `/api/pipeline/runs/${runId}?skippedOffset=${sOffset}&skippedLimit=${skippedLimit}&suppliersOffset=${supOffset}&suppliersLimit=${suppliersLimit}`
    );
    const json = (await resp.json()) as RunDetailResponse;
    setData(json);
    setLoading(false);
  }

  useEffect(() => {
    void fetchRun(skippedOffset, suppliersOffset);
  }, [skippedOffset, suppliersOffset]);

  async function deleteRun() {
    if (
      !window.confirm(
        "Are you sure you want to delete this run and all data imported by it? This cannot be undone."
      )
    ) {
      return;
    }

    setDeleting(true);
    try {
      const resp = await fetch(`/api/pipeline/runs/${runId}`, {
        method: "DELETE",
      });
      if (!resp.ok) {
        const json = await resp.json();
        throw new Error(json.error || "Failed to delete run");
      }
      await fetchRun();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
      setDeleting(false);
    }
  }

  const fetchRunRef = useRef(fetchRun);
  fetchRunRef.current = fetchRun;

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      await fetchRunRef.current();
    };
    void tick();
    const handle = setInterval(() => void tick(), 2000);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [runId]);

  // Auto-scroll logs to bottom
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [liveLogs]);

  // Connect to SSE for live log streaming when run is in progress
  useEffect(() => {
    const run = data.run;
    if (!run) return;

    const isRunning = run.status === "running" || run.status === "queued";
    if (!isRunning) {
      setStreamStatus("complete");
      return;
    }

    // Clean up previous connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    setLiveLogs([]);
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
        setLiveLogs((prev) => [...prev, entry]);
      } catch (err) {
        console.error(`[SSE] Failed to parse log data:`, e.data, err);
      }
    });

    es.addEventListener("complete", (e) => {
      console.log(`[SSE] Run complete:`, e.data);
      setStreamStatus("complete");
      es.close();
      // Refresh to get final state
      void fetchRun();
    });

    es.onerror = (e) => {
      console.error(`[SSE] EventSource error:`, e);
      setStreamStatus("complete");
      es.close();
    };

    return () => {
      es.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.run?.status, runId]);

  const run = data.run;
  const isDone =
    run?.status === "succeeded" ||
    run?.status === "failed" ||
    run?.status === "cancelled" ||
    run?.status === "deleted";

  const stageMetrics = data.stages?.[0]?.metrics as Metrics | undefined;

  // Use live logs if streaming, otherwise use DB logs
  const displayLogs =
    liveLogs.length > 0
      ? liveLogs.map((l, i) => ({
          id: i,
          ts: l.timestamp,
          level: l.level,
          message: l.message,
          meta: l.meta,
        }))
      : data.logs ?? [];

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Pipeline Run #{runId}
          </h1>
          <Button
            variant="link"
            asChild
            className="h-auto p-0 text-muted-foreground"
          >
            <Link href="/pipeline">
              <ArrowLeft className="size-4" />
              Back to pipeline
            </Link>
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void fetchRun()}
            disabled={deleting}
          >
            <RefreshCw className="size-4" />
            Refresh
          </Button>
          {run?.status !== "deleted" && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => void deleteRun()}
              disabled={deleting}
            >
              {deleting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Trash2 className="size-4" />
              )}
              Delete Run & Data
            </Button>
          )}
        </div>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading…
        </div>
      )}

      {data.error && (
        <div className="rounded-md bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">
          {data.error}
        </div>
      )}

      {run && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-3">
              Run Details
              {!isDone && (
                <Badge variant="secondary" className="gap-1">
                  <Loader2 className="size-3 animate-spin" />
                  Running
                </Badge>
              )}
            </CardTitle>
            <CardDescription className="flex items-center gap-2">
              {data.asset?.originalName && (
                <div className="flex items-center gap-2">
                  <span className="font-medium text-foreground">
                    {data.asset.originalName}
                  </span>
                  <Button variant="outline" size="sm" asChild className="h-7 px-2">
                    <a
                      href={`/api/pipeline/assets/${data.asset.id}/download`}
                      title="Download original file"
                    >
                      <FileSpreadsheet className="mr-1.5 h-3.5 w-3.5" />
                      Download
                    </a>
                  </Button>
                </div>
              )}
              {data.asset?.sizeBytes && (
                <span className="text-muted-foreground">
                  • {formatBytes(data.asset.sizeBytes)}
                </span>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Status Row */}
            <div className="flex flex-wrap gap-6 text-sm">
              <div className="flex items-center gap-2">
                {run.status === "succeeded" ? (
                  <CheckCircle2 className="size-5 text-emerald-600" />
                ) : run.status === "failed" || run.status === "deleted" ? (
                  <XCircle className="size-5 text-destructive" />
                ) : (
                  <Loader2 className="size-5 text-muted-foreground animate-spin" />
                )}
                <StatusBadge status={run.status} />
              </div>

              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Type:</span>
                <Badge variant="outline" className="font-normal capitalize">
                  {run.fromStageId === "matchSuppliers" 
                    ? "Match Suppliers" 
                    : run.fromStageId?.startsWith("import") || !run.fromStageId 
                    ? "Import Spending" 
                    : run.fromStageId.replace(/([A-Z])/g, ' $1').trim()}
                </Badge>
              </div>

              {run.dryRun && (
                <Badge variant="secondary" className="text-xs">
                  Dry Run
                </Badge>
              )}

              {run.startedAt && (
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Clock className="size-4" />
                  <span>{formatDuration(run.startedAt, run.finishedAt)}</span>
                </div>
              )}

              <div className="text-muted-foreground">
                Asset:{" "}
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                  {run.assetId}
                </code>
              </div>

              {data.dateRange && (
                <div className="flex items-center gap-1.5">
                  <Clock className="size-4 text-primary" />
                  <span className="text-sm font-semibold text-foreground">
                    {new Date(data.dateRange.minDate).toLocaleDateString()} - {new Date(data.dateRange.maxDate).toLocaleDateString()}
                  </span>
                </div>
              )}
            </div>

            {/* Metrics Cards */}
            <MetricsDisplay metrics={stageMetrics} />
          </CardContent>
        </Card>
      )}

      {/* Skipped Rows Table */}
      <SkippedRowsTable
        rows={data.skippedRows}
        totalCount={data.skippedRowsCount}
        offset={skippedOffset}
        limit={skippedLimit}
        onPageChange={setSkippedOffset}
      />

      {/* Suppliers Table */}
      <SuppliersTable
        suppliers={data.suppliers}
        totalCount={data.suppliersCount}
        offset={suppliersOffset}
        limit={suppliersLimit}
        onPageChange={setSuppliersOffset}
        onLinked={() => void fetchRun()}
      />

      {/* Stages */}
      <Card>
        <CardHeader>
          <CardTitle>Stages</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Stage</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data.stages ?? []).map((s) => (
                <TableRow key={s.id}>
                  <TableCell>
                    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                      {s.stageId}
                    </code>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={s.status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDuration(s.startedAt, s.finishedAt) ?? "—"}
                  </TableCell>
                  <TableCell>
                    {s.error && (
                      <div className="text-xs text-destructive">{s.error}</div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {(data.stages ?? []).length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={4}
                    className="h-24 text-center text-muted-foreground"
                  >
                    No stage rows yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Logs */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Logs
            {streamStatus === "connected" && (
              <Badge variant="secondary" className="text-xs">
                <span className="mr-1.5 size-2 rounded-full bg-green-500 animate-pulse inline-block" />
                Live
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border bg-zinc-950 p-4 font-mono text-xs text-zinc-100 max-h-96 overflow-auto">
            <div className="space-y-1">
              {displayLogs.map((l) => (
                <div key={l.id} className="flex gap-2">
                  <span className="text-zinc-500 shrink-0">
                    {l.ts ? new Date(l.ts).toISOString().slice(11, 23) : ""}
                  </span>
                  <span
                    className={cn(
                      "uppercase font-semibold shrink-0 w-12",
                      l.level === "error" && "text-red-400",
                      l.level === "warn" && "text-yellow-400",
                      l.level === "info" && "text-blue-400",
                      l.level === "debug" && "text-zinc-500"
                    )}
                  >
                    [{l.level}]
                  </span>
                  <span className="text-zinc-200">{l.message}</span>
                  {l.meta && Object.keys(l.meta).length > 0 && (
                    <span className="text-zinc-500 truncate">
                      {JSON.stringify(l.meta)}
                    </span>
                  )}
                </div>
              ))}
              {displayLogs.length === 0 && (
                <div className="text-zinc-500">No logs yet.</div>
              )}
              <div ref={logsEndRef} />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
