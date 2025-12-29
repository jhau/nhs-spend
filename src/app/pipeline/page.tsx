"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type PresignResponse = { assetId: number; uploadUrl: string; objectKey: string; error?: string };
type CreateRunResponse = { runId: number; error?: string };

export default function PipelinePage() {
  const [file, setFile] = useState<File | null>(null);
  const [assetId, setAssetId] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [running, setRunning] = useState(false);
  const [runId, setRunId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runs, setRuns] = useState<any[]>([]);

  const canUpload = useMemo(() => !!file && !uploading, [file, uploading]);
  const canRun = useMemo(() => !!assetId && !running, [assetId, running]);

  async function refreshRuns() {
    const resp = await fetch("/api/pipeline/runs?limit=20");
    const data = await resp.json();
    setRuns(data.runs ?? []);
  }

  useEffect(() => {
    void refreshRuns();
  }, []);

  async function uploadSelected() {
    if (!file) return;
    setError(null);
    setUploading(true);
    setRunId(null);
    setAssetId(null);

    try {
      const presignResp = await fetch("/api/pipeline/assets/presign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          originalName: file.name,
          contentType: file.type || "application/octet-stream",
          sizeBytes: file.size,
        }),
      });
      const presignData = (await presignResp.json()) as PresignResponse;
      if (!presignResp.ok) {
        throw new Error(presignData.error || "Failed to presign upload");
      }

      const putResp = await fetch(presignData.uploadUrl, {
        method: "PUT",
        body: file,
        headers: file.type ? { "Content-Type": file.type } : undefined,
      });
      if (!putResp.ok) {
        throw new Error(`Upload failed (${putResp.status})`);
      }

      setAssetId(presignData.assetId);
      await refreshRuns();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  }

  async function startRun() {
    if (!assetId) return;
    setError(null);
    setRunning(true);
    setRunId(null);
    try {
      const resp = await fetch("/api/pipeline/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetId, dryRun: false }),
      });
      const data = (await resp.json()) as CreateRunResponse;
      if (!resp.ok) {
        throw new Error(data.error || "Failed to start run");
      }
      setRunId(data.runId);
      await refreshRuns();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl p-6 space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Data pipeline</h1>
        <p className="text-sm text-gray-600">
          Upload an Excel workbook to object storage and run the import pipeline.
        </p>
      </div>

      <div className="rounded border p-4 space-y-3">
        <div className="flex items-center gap-3">
          <input
            type="file"
            accept=".xlsx,.xls"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <button
            className="rounded bg-black px-3 py-2 text-sm text-white disabled:opacity-40"
            disabled={!canUpload}
            onClick={() => void uploadSelected()}
          >
            {uploading ? "Uploading…" : "Upload"}
          </button>
        </div>

        {assetId && (
          <div className="text-sm">
            Uploaded as asset <span className="font-mono">{assetId}</span>
          </div>
        )}

        <div>
          <button
            className="rounded bg-blue-600 px-3 py-2 text-sm text-white disabled:opacity-40"
            disabled={!canRun}
            onClick={() => void startRun()}
          >
            {running ? "Starting…" : "Run import"}
          </button>
          {runId && (
            <span className="ml-3 text-sm">
              Run started:{" "}
              <Link className="underline" href={`/pipeline/runs/${runId}`}>
                {runId}
              </Link>
            </span>
          )}
        </div>

        {error && <div className="text-sm text-red-600">{error}</div>}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Recent runs</h2>
          <button className="text-sm underline" onClick={() => void refreshRuns()}>
            refresh
          </button>
        </div>

        <div className="rounded border">
          <table className="w-full text-sm">
            <thead className="border-b bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left">Run</th>
                <th className="px-3 py-2 text-left">Asset</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-left">Created</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="border-b last:border-b-0">
                  <td className="px-3 py-2">
                    <Link className="underline" href={`/pipeline/runs/${r.id}`}>
                      {r.id}
                    </Link>
                  </td>
                  <td className="px-3 py-2 font-mono">{r.assetId}</td>
                  <td className="px-3 py-2">{r.status}</td>
                  <td className="px-3 py-2">
                    {r.createdAt ? new Date(r.createdAt).toLocaleString() : ""}
                  </td>
                </tr>
              ))}
              {runs.length === 0 && (
                <tr>
                  <td className="px-3 py-4 text-gray-600" colSpan={4}>
                    No runs yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

