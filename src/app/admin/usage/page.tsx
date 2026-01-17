import React from "react";
import { db } from "@/db";
import { assistantRequests } from "@/db/schema";
import { desc, count, sum, avg } from "drizzle-orm";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { 
  BarChart3, 
  Clock, 
  Coins, 
  Database, 
  Zap, 
  AlertCircle,
  Clock3,
  Search
} from "lucide-react";
import { format } from "date-fns";

export const dynamic = "force-dynamic";

export default async function UsageAnalyticsPage() {
  const requests = await db
    .select()
    .from(assistantRequests)
    .orderBy(desc(assistantRequests.ts))
    .limit(100);

  const [stats] = await db
    .select({
      totalCount: count(),
      totalTokens: sum(assistantRequests.totalTokens),
      totalCost: sum(assistantRequests.costUsd),
      avgTime: avg(assistantRequests.totalTimeMs),
    })
    .from(assistantRequests);

  const totalCount = stats.totalCount || 0;
  const totalCost = parseFloat(stats.totalCost || "0");
  const totalTokens = parseInt(stats.totalTokens || "0");
  const avgTime = parseFloat(stats.avgTime || "0");

  return (
    <div className="flex flex-col gap-8 p-8 max-w-[1600px] mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-3">
            <BarChart3 className="h-8 w-8 text-indigo-600" />
            Usage Analytics
          </h1>
          <p className="text-slate-500 mt-2 text-lg">
            Detailed breakdown of LLM usage, costs, and tool performance.
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Last Updated</p>
          <p className="text-sm font-medium text-slate-900">{format(new Date(), "MMM d, yyyy HH:mm")}</p>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <SummaryCard 
          icon={Search} 
          label="Total Requests" 
          value={totalCount.toLocaleString()} 
          subValue="All time"
          color="bg-blue-50 text-blue-600"
        />
        <SummaryCard 
          icon={Coins} 
          label="Estimated Cost" 
          value={`$${totalCost.toFixed(4)}`} 
          subValue="All time"
          color="bg-emerald-50 text-emerald-600"
        />
        <SummaryCard 
          icon={Zap} 
          label="Total Tokens" 
          value={totalTokens.toLocaleString()} 
          subValue="Prompt + Completion"
          color="bg-amber-50 text-amber-600"
        />
        <SummaryCard 
          icon={Clock} 
          label="Avg Latency" 
          value={`${(avgTime / 1000).toFixed(2)}s`} 
          subValue="Per request"
          color="bg-indigo-50 text-indigo-600"
        />
      </div>

      {/* Detailed Log Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
          <h2 className="font-semibold text-slate-800">Request History</h2>
        </div>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent bg-slate-50/30">
              <TableHead className="w-[180px]">Timestamp</TableHead>
              <TableHead>Model</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Tokens</TableHead>
              <TableHead className="text-right">Cost</TableHead>
              <TableHead className="text-right">Total Time</TableHead>
              <TableHead className="text-right">LLM / DB Time</TableHead>
              <TableHead className="text-center w-[100px]">Tools</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {requests.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-12 text-slate-500">
                  No requests recorded yet.
                </TableCell>
              </TableRow>
            ) : (
              requests.map((r) => (
                <TableRow key={r.id} className="group hover:bg-slate-50 transition-colors">
                  <TableCell className="font-mono text-[11px] text-slate-500 whitespace-nowrap">
                    {r.ts ? format(new Date(r.ts), "yyyy-MM-dd HH:mm:ss") : "-"}
                  </TableCell>
                  <TableCell className="max-w-[200px]">
                    <div className="text-sm font-medium text-slate-700 truncate" title={r.model || "Unknown"}>
                      {r.model?.split('/').pop() || "default"}
                    </div>
                    <div className="text-[10px] text-slate-400 truncate font-mono">
                      {r.requestId}
                    </div>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={r.status} />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="text-sm font-medium text-slate-700">
                      {r.totalTokens?.toLocaleString() ?? "-"}
                    </div>
                    <div className="text-[10px] text-slate-400">
                      {r.promptTokens ?? 0} in / {r.completionTokens ?? 0} out
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <span className="text-sm font-mono text-emerald-600">
                      {r.costUsd ? `$${parseFloat(r.costUsd).toFixed(5)}` : "-"}
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-medium text-slate-700">
                    {r.totalTimeMs ? `${(r.totalTimeMs / 1000).toFixed(2)}s` : "-"}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex flex-col items-end gap-1">
                      <div className="flex items-center gap-1.5 text-[11px] text-indigo-600 font-medium">
                        <Zap size={10} />
                        {r.llmTimeMs ? `${(r.llmTimeMs / 1000).toFixed(2)}s` : "0s"}
                      </div>
                      <div className="flex items-center gap-1.5 text-[11px] text-amber-600 font-medium">
                        <Database size={10} />
                        {r.dbTimeMs ? `${(r.dbTimeMs / 1000).toFixed(2)}s` : "0s"}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-center">
                    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-slate-100 text-slate-600 text-xs font-bold border border-slate-200">
                      {Array.isArray(r.toolCalls) ? r.toolCalls.length : 0}
                    </span>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function SummaryCard({ icon: Icon, label, value, subValue, color }: any) {
  return (
    <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
      <div className="flex items-center gap-4">
        <div className={`p-3 rounded-lg ${color}`}>
          <Icon className="h-6 w-6" />
        </div>
        <div>
          <p className="text-sm font-medium text-slate-500 uppercase tracking-wider">{label}</p>
          <div className="flex items-baseline gap-2">
            <p className="text-2xl font-bold text-slate-900">{value}</p>
          </div>
          <p className="text-xs text-slate-400 mt-1">{subValue}</p>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const configs: Record<string, { label: string; class: string; icon: any }> = {
    ok: { label: "Success", class: "bg-emerald-50 text-emerald-700 border-emerald-200", icon: Zap },
    error: { label: "Error", class: "bg-rose-50 text-rose-700 border-rose-200", icon: AlertCircle },
    aborted: { label: "Aborted", class: "bg-slate-50 text-slate-700 border-slate-200", icon: Clock3 },
  };

  const config = configs[status] || { label: status, class: "bg-slate-50 text-slate-700 border-slate-200", icon: Clock3 };
  const Icon = config.icon;

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border ${config.class}`}>
      <Icon size={12} />
      {config.label}
    </span>
  );
}
