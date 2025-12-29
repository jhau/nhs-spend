"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type RunDetailResponse = {
  run?: any;
  asset?: any;
  stages?: any[];
  logs?: any[];
  error?: string;
};

export default function PipelineRunPage({
  params,
}: {
  params: { id: string };
}) {
  const runId = params.id;
  const [data, setData] = useState<RunDetailResponse>({});
  const [loading, setLoading] = useState(true);

  async function fetchRun() {
    const resp = await fetch(`/api/pipeline/runs/${runId}`);
    const json = (await resp.json()) as RunDetailResponse;
    setData(json);
    setLoading(false);
  }

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      await fetchRun();
    };
    void tick();
    const handle = setInterval(() => void tick(), 2000);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  const run = data.run;
  const isDone =
    run?.status === "succeeded" || run?.status === "failed" || run?.status === "cancelled";

  return (
    <div className="mx-auto max-w-4xl p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Pipeline run {runId}</h1>
          <div className="text-sm text-gray-600">
            <Link className="underline" href="/pipeline">
              Back to pipeline
            </Link>
          </div>
        </div>
        <button className="text-sm underline" onClick={() => void fetchRun()}>
          refresh
        </button>
      </div>

      {loading && <div className="text-sm text-gray-600">Loading…</div>}
      {data.error && <div className="text-sm text-red-600">{data.error}</div>}

      {run && (
        <div className="rounded border p-4 text-sm space-y-2">
          <div>
            <span className="font-semibold">Status:</span> {run.status}{" "}
            {!isDone && <span className="text-gray-600">(polling)</span>}
          </div>
          <div>
            <span className="font-semibold">Asset:</span>{" "}
            <span className="font-mono">{run.assetId}</span>{" "}
            {data.asset?.originalName ? (
              <span className="text-gray-600">({data.asset.originalName})</span>
            ) : null}
          </div>
          <div>
            <span className="font-semibold">Dry run:</span> {String(run.dryRun)}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <h2 className="text-lg font-semibold">Stages</h2>
        <div className="rounded border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left">Stage</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-left">Metrics</th>
              </tr>
            </thead>
            <tbody>
              {(data.stages ?? []).map((s) => (
                <tr key={s.id} className="border-b last:border-b-0">
                  <td className="px-3 py-2 font-mono">{s.stageId}</td>
                  <td className="px-3 py-2">{s.status}</td>
                  <td className="px-3 py-2">
                    <pre className="whitespace-pre-wrap text-xs">
                      {s.metrics ? JSON.stringify(s.metrics, null, 2) : ""}
                    </pre>
                    {s.error ? (
                      <div className="text-xs text-red-600">{s.error}</div>
                    ) : null}
                  </td>
                </tr>
              ))}
              {(data.stages ?? []).length === 0 && (
                <tr>
                  <td className="px-3 py-4 text-gray-600" colSpan={3}>
                    No stage rows yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="space-y-2">
        <h2 className="text-lg font-semibold">Logs</h2>
        <div className="rounded border p-3 bg-black text-white">
          <div className="space-y-1 font-mono text-xs">
            {(data.logs ?? []).map((l) => (
              <div key={l.id}>
                <span className="text-gray-400">
                  {l.ts ? new Date(l.ts).toISOString() : ""}
                </span>{" "}
                <span className="text-gray-300">[{l.level}]</span>{" "}
                <span>{l.message}</span>{" "}
                {l.meta ? (
                  <span className="text-gray-400">
                    {JSON.stringify(l.meta)}
                  </span>
                ) : null}
              </div>
            ))}
            {(data.logs ?? []).length === 0 && (
              <div className="text-gray-400">No logs yet.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

