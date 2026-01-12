import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { db } from "@/db";
import { sql } from "drizzle-orm";
import {
  Database,
  Building2,
  Users,
  Calendar,
  TrendingUp,
  CheckCircle2,
  Clock,
  AlertCircle,
  FileSpreadsheet,
  Landmark,
  Hospital,
  Briefcase,
  PoundSterling,
} from "lucide-react";

async function getDashboardData() {
  const [
    spendStats,
    buyerStats,
    supplierStats,
    entityStats,
    pipelineStats,
    topBuyers,
    topSuppliers,
    buyersByType,
    badDateStats,
  ] = await Promise.all([
    db.execute(sql`
      SELECT 
        COUNT(*)::int as total_entries,
        COALESCE(SUM(amount), 0)::numeric as total_value,
        MIN(CASE WHEN payment_date >= '2000-01-01' AND payment_date <= '2030-01-01' THEN payment_date END)::text as min_date,
        MAX(CASE WHEN payment_date >= '2000-01-01' AND payment_date <= '2030-01-01' THEN payment_date END)::text as max_date,
        AVG(amount)::numeric as avg_transaction
      FROM spend_entries
    `),
    db.execute(sql`
      SELECT 
        COUNT(*)::int as total,
        COUNT(CASE WHEN match_status = 'matched' THEN 1 END)::int as verified,
        COUNT(CASE WHEN match_status = 'pending' THEN 1 END)::int as pending,
        COUNT(CASE WHEN match_status = 'pending_review' THEN 1 END)::int as review,
        COUNT(CASE WHEN match_status = 'no_match' THEN 1 END)::int as no_match,
        COUNT(CASE WHEN manually_verified = true THEN 1 END)::int as manually_verified
      FROM buyers
    `),
    db.execute(sql`
      SELECT 
        COUNT(*)::int as total,
        COUNT(CASE WHEN match_status = 'matched' THEN 1 END)::int as matched,
        COUNT(CASE WHEN match_status = 'pending' THEN 1 END)::int as pending,
        COUNT(CASE WHEN match_status = 'pending_review' THEN 1 END)::int as review,
        COUNT(CASE WHEN match_status = 'no_match' THEN 1 END)::int as no_match,
        COUNT(CASE WHEN match_status = 'skipped' THEN 1 END)::int as skipped,
        COUNT(CASE WHEN manually_verified = true THEN 1 END)::int as manually_verified
      FROM suppliers
    `),
    db.execute(sql`
      SELECT 
        COUNT(*)::int as total,
        COUNT(CASE WHEN entity_type = 'company' THEN 1 END)::int as companies,
        COUNT(CASE WHEN entity_type IN ('nhs_trust', 'nhs_icb', 'nhs_practice') THEN 1 END)::int as nhs_orgs,
        COUNT(CASE WHEN entity_type = 'council' THEN 1 END)::int as councils,
        COUNT(CASE WHEN entity_type = 'government_department' THEN 1 END)::int as gov_depts
      FROM entities
    `),
    db.execute(sql`
      SELECT 
        (SELECT COUNT(*)::int FROM pipeline_assets) as total_assets,
        (SELECT COUNT(*)::int FROM pipeline_runs) as total_runs,
        (SELECT COUNT(*)::int FROM pipeline_runs WHERE status = 'succeeded') as successful_runs,
        (SELECT COUNT(*)::int FROM pipeline_runs WHERE status = 'failed') as failed_runs,
        (SELECT COUNT(*)::int FROM pipeline_skipped_rows) as skipped_rows
    `),
    db.execute(sql`
      SELECT b.name, SUM(se.amount)::numeric as total_spend
      FROM buyers b
      JOIN spend_entries se ON se.buyer_id = b.id
      GROUP BY b.id, b.name
      ORDER BY total_spend DESC
      LIMIT 5
    `),
    db.execute(sql`
      SELECT s.name, SUM(se.amount)::numeric as total_spend
      FROM suppliers s
      JOIN spend_entries se ON se.supplier_id = s.id
      GROUP BY s.id, s.name
      ORDER BY total_spend DESC
      LIMIT 5
    `),
    db.execute(sql`
      SELECT 
        COALESCE(e.entity_type, 'unlinked') as type,
        COUNT(*)::int as count
      FROM buyers b
      LEFT JOIN entities e ON b.entity_id = e.id
      GROUP BY e.entity_type
      ORDER BY count DESC
    `),
    // Find imports with bad dates (outside 2000-2030 range)
    db.execute(sql`
      SELECT 
        pa.original_name,
        pa.id as asset_id,
        COUNT(*)::int as bad_date_count,
        MIN(se.payment_date)::text as earliest_bad_date,
        MAX(se.payment_date)::text as latest_bad_date
      FROM spend_entries se
      JOIN pipeline_assets pa ON se.asset_id = pa.id
      WHERE se.payment_date < '2000-01-01' OR se.payment_date > '2030-01-01'
      GROUP BY pa.id, pa.original_name
      ORDER BY bad_date_count DESC
      LIMIT 10
    `),
  ]);

  return {
    spend: spendStats.rows[0] as {
      total_entries: number;
      total_value: string;
      min_date: string;
      max_date: string;
      avg_transaction: string;
    },
    buyers: buyerStats.rows[0] as {
      total: number;
      verified: number;
      pending: number;
      review: number;
      no_match: number;
      manually_verified: number;
    },
    suppliers: supplierStats.rows[0] as {
      total: number;
      matched: number;
      pending: number;
      review: number;
      no_match: number;
      skipped: number;
      manually_verified: number;
    },
    entities: entityStats.rows[0] as {
      total: number;
      companies: number;
      nhs_orgs: number;
      councils: number;
      gov_depts: number;
    },
    pipeline: pipelineStats.rows[0] as {
      total_assets: number;
      total_runs: number;
      successful_runs: number;
      failed_runs: number;
      skipped_rows: number;
    },
    topBuyers: topBuyers.rows as { name: string; total_spend: string }[],
    topSuppliers: topSuppliers.rows as { name: string; total_spend: string }[],
    buyersByType: buyersByType.rows as { type: string; count: number }[],
    badDateStats: badDateStats.rows as {
      original_name: string;
      asset_id: number;
      bad_date_count: number;
      earliest_bad_date: string;
      latest_bad_date: string;
    }[],
  };
}

function formatCurrency(amount: number): string {
  if (amount >= 1_000_000_000)
    return `£${(amount / 1_000_000_000).toFixed(2)}B`;
  if (amount >= 1_000_000) return `£${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `£${(amount / 1_000).toFixed(0)}K`;
  return `£${amount.toFixed(0)}`;
}

function formatNumber(num: number): string {
  return num.toLocaleString("en-GB");
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default async function AdminDashboardPage() {
  const data = await getDashboardData();

  const buyerVerificationRate =
    data.buyers.total > 0
      ? ((data.buyers.verified / data.buyers.total) * 100).toFixed(1)
      : "0";

  const supplierMatchRate =
    data.suppliers.total > 0
      ? ((data.suppliers.matched / data.suppliers.total) * 100).toFixed(1)
      : "0";

  return (
    <div className="min-h-screen bg-slate-50 p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-slate-900">Admin Dashboard</h1>
          <p className="text-slate-500 mt-1">
            UK Public Sector Spending Dataset Overview
          </p>
        </div>

        {/* Hero Stats */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-8">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Database className="size-4 text-blue-500" />
                Spending Records
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-slate-900">
                {formatNumber(data.spend.total_entries)}
              </div>
              <p className="text-xs text-muted-foreground mt-1">Total transactions</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <PoundSterling className="size-4 text-emerald-500" />
                Total Value
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-slate-900">
                {formatCurrency(parseFloat(data.spend.total_value))}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Avg: {formatCurrency(parseFloat(data.spend.avg_transaction))}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Calendar className="size-4 text-violet-500" />
                Date Range
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-lg font-bold text-slate-900">
                {data.spend.min_date ? formatDate(data.spend.min_date) : "N/A"}
              </div>
              <div className="text-lg font-bold text-slate-900">
                → {data.spend.max_date ? formatDate(data.spend.max_date) : "N/A"}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <TrendingUp className="size-4 text-amber-500" />
                Data Quality
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-slate-900">{buyerVerificationRate}%</div>
              <p className="text-xs text-muted-foreground mt-1">Buyers verified</p>
            </CardContent>
          </Card>
        </div>

        {/* Buyers & Suppliers */}
        <div className="grid gap-6 md:grid-cols-2 mb-8">
          {/* Buyers Section */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="size-5" />
                Buyers
              </CardTitle>
              <CardDescription>
                Public sector organisations making purchases
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-4xl font-bold mb-4">
                {formatNumber(data.buyers.total)}
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="size-4 text-emerald-500" />
                    <span className="text-sm">Verified (Matched)</span>
                  </div>
                  <Badge
                    variant="secondary"
                    className="bg-emerald-100 text-emerald-700"
                  >
                    {data.buyers.verified}
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Clock className="size-4 text-amber-500" />
                    <span className="text-sm">Pending Review</span>
                  </div>
                  <Badge
                    variant="secondary"
                    className="bg-amber-100 text-amber-700"
                  >
                    {data.buyers.review}
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="size-4 text-slate-400" />
                    <span className="text-sm">Pending</span>
                  </div>
                  <Badge variant="outline">{data.buyers.pending}</Badge>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="size-4 text-red-400" />
                    <span className="text-sm">No Match</span>
                  </div>
                  <Badge variant="outline" className="text-red-600">
                    {data.buyers.no_match}
                  </Badge>
                </div>
              </div>

              <div className="mt-6 pt-4 border-t">
                <p className="text-xs font-medium text-slate-500 mb-2">
                  BY ENTITY TYPE
                </p>
                <div className="flex flex-wrap gap-2">
                  {data.buyersByType.map((bt) => (
                    <Badge key={bt.type} variant="outline" className="text-xs">
                      {bt.type}: {bt.count}
                    </Badge>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Suppliers Section */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="size-5" />
                Suppliers
              </CardTitle>
              <CardDescription>
                Vendors receiving payments from public sector
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-4xl font-bold mb-4">
                {formatNumber(data.suppliers.total)}
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="size-4 text-emerald-500" />
                    <span className="text-sm">Matched to Entity</span>
                  </div>
                  <Badge
                    variant="secondary"
                    className="bg-emerald-100 text-emerald-700"
                  >
                    {formatNumber(data.suppliers.matched)}
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Clock className="size-4 text-amber-500" />
                    <span className="text-sm">Pending Review</span>
                  </div>
                  <Badge
                    variant="secondary"
                    className="bg-amber-100 text-amber-700"
                  >
                    {formatNumber(data.suppliers.review)}
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="size-4 text-slate-400" />
                    <span className="text-sm">Pending</span>
                  </div>
                  <Badge variant="outline">
                    {formatNumber(data.suppliers.pending)}
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="size-4 text-slate-500" />
                    <span className="text-sm">Skipped</span>
                  </div>
                  <Badge variant="outline">
                    {formatNumber(data.suppliers.skipped)}
                  </Badge>
                </div>
              </div>

              <div className="mt-6 pt-4 border-t">
                <p className="text-xs font-medium text-slate-500 mb-2">
                  MATCH RATE
                </p>
                <div className="w-full bg-slate-200 rounded-full h-2">
                  <div
                    className="bg-emerald-500 h-2 rounded-full"
                    style={{ width: `${supplierMatchRate}%` }}
                  />
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  {supplierMatchRate}% matched to entities
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Entity Registry & Pipeline */}
        <div className="grid gap-6 md:grid-cols-2 mb-8">
          {/* Entity Registry */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Landmark className="size-5" />
                Entity Registry
              </CardTitle>
              <CardDescription>
                Central registry of all verified organisations
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-4xl font-bold mb-4">
                {formatNumber(data.entities.total)}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="p-3 bg-slate-50 rounded-lg">
                  <div className="flex items-center gap-2 text-slate-600 mb-1">
                    <Building2 className="size-4" />
                    <span className="text-xs font-medium">Companies</span>
                  </div>
                  <div className="text-xl font-bold">
                    {formatNumber(data.entities.companies)}
                  </div>
                </div>
                <div className="p-3 bg-slate-50 rounded-lg">
                  <div className="flex items-center gap-2 text-slate-600 mb-1">
                    <Hospital className="size-4" />
                    <span className="text-xs font-medium">NHS Orgs</span>
                  </div>
                  <div className="text-xl font-bold">
                    {formatNumber(data.entities.nhs_orgs)}
                  </div>
                </div>
                <div className="p-3 bg-slate-50 rounded-lg">
                  <div className="flex items-center gap-2 text-slate-600 mb-1">
                    <Landmark className="size-4" />
                    <span className="text-xs font-medium">Councils</span>
                  </div>
                  <div className="text-xl font-bold">
                    {formatNumber(data.entities.councils)}
                  </div>
                </div>
                <div className="p-3 bg-slate-50 rounded-lg">
                  <div className="flex items-center gap-2 text-slate-600 mb-1">
                    <Briefcase className="size-4" />
                    <span className="text-xs font-medium">Gov Depts</span>
                  </div>
                  <div className="text-xl font-bold">
                    {formatNumber(data.entities.gov_depts)}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Pipeline Stats */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileSpreadsheet className="size-5" />
                Data Pipeline
              </CardTitle>
              <CardDescription>Import pipeline statistics</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                  <span className="text-sm font-medium">Assets Imported</span>
                  <span className="text-xl font-bold">
                    {data.pipeline.total_assets}
                  </span>
                </div>
                <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                  <span className="text-sm font-medium">Pipeline Runs</span>
                  <span className="text-xl font-bold">
                    {data.pipeline.total_runs}
                  </span>
                </div>
                <div className="flex items-center justify-between p-3 bg-emerald-50 rounded-lg">
                  <span className="text-sm font-medium text-emerald-700">
                    Successful Runs
                  </span>
                  <span className="text-xl font-bold text-emerald-700">
                    {data.pipeline.successful_runs}
                  </span>
                </div>
                <div className="flex items-center justify-between p-3 bg-red-50 rounded-lg">
                  <span className="text-sm font-medium text-red-700">
                    Failed Runs
                  </span>
                  <span className="text-xl font-bold text-red-700">
                    {data.pipeline.failed_runs}
                  </span>
                </div>
                <div className="flex items-center justify-between p-3 bg-amber-50 rounded-lg">
                  <span className="text-sm font-medium text-amber-700">
                    Skipped Rows
                  </span>
                  <span className="text-xl font-bold text-amber-700">
                    {formatNumber(data.pipeline.skipped_rows)}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Data Quality Issues */}
        {data.badDateStats.length > 0 && (
          <Card className="mb-8 border-amber-200 bg-amber-50/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-amber-700">
                <AlertCircle className="size-5" />
                Data Quality: Invalid Dates Found
              </CardTitle>
              <CardDescription>
                These imports contain payment dates outside the expected range (2000-2030)
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-amber-200">
                      <th className="text-left py-2 px-3 font-medium text-amber-800">Import File</th>
                      <th className="text-right py-2 px-3 font-medium text-amber-800">Bad Dates</th>
                      <th className="text-left py-2 px-3 font-medium text-amber-800">Earliest</th>
                      <th className="text-left py-2 px-3 font-medium text-amber-800">Latest</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.badDateStats.map((item) => (
                      <tr key={item.asset_id} className="border-b border-amber-100">
                        <td className="py-2 px-3 font-medium truncate max-w-[300px]">
                          {item.original_name}
                        </td>
                        <td className="py-2 px-3 text-right">
                          <Badge variant="secondary" className="bg-amber-200 text-amber-800">
                            {formatNumber(item.bad_date_count)}
                          </Badge>
                        </td>
                        <td className="py-2 px-3 font-mono text-xs text-amber-700">
                          {item.earliest_bad_date}
                        </td>
                        <td className="py-2 px-3 font-mono text-xs text-amber-700">
                          {item.latest_bad_date}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Top Buyers & Suppliers */}
        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Top 5 Buyers by Spend</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {data.topBuyers.map((buyer, idx) => (
                  <div
                    key={buyer.name}
                    className="flex items-center justify-between p-2 hover:bg-slate-50 rounded"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium text-slate-400 w-5">
                        {idx + 1}.
                      </span>
                      <span className="text-sm font-medium truncate max-w-[250px]">
                        {buyer.name}
                      </span>
                    </div>
                    <span className="text-sm font-bold text-emerald-600">
                      {formatCurrency(parseFloat(buyer.total_spend))}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Top 5 Suppliers by Revenue</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {data.topSuppliers.map((supplier, idx) => (
                  <div
                    key={supplier.name}
                    className="flex items-center justify-between p-2 hover:bg-slate-50 rounded"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium text-slate-400 w-5">
                        {idx + 1}.
                      </span>
                      <span className="text-sm font-medium truncate max-w-[250px]">
                        {supplier.name}
                      </span>
                    </div>
                    <span className="text-sm font-bold text-blue-600">
                      {formatCurrency(parseFloat(supplier.total_spend))}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

