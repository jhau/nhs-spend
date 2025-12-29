"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Search,
  Play,
  Users,
  Building2,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  TrendingUp,
  Check,
  X,
  Loader2,
  AlertCircle,
  MoreHorizontal,
  RefreshCw,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

type Supplier = {
  id: number;
  name: string;
  matchStatus: string;
  matchConfidence: string | null;
  companyId: number | null;
  companyName: string | null;
  companyNumber: string | null;
  totalSpend: number;
  transactionCount: number;
};

type Suggestion = {
  company_number: string;
  title: string;
  company_status: string;
  company_type: string;
  similarity?: number;
};

type SuppliersResponse = {
  suppliers: Supplier[];
  totalCount: number;
  limit: number;
  offset: number;
};

export default function SuppliersPage() {
  const [activeTab, setActiveTab] = useState<"directory" | "matching">("directory");
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const limit = 20;

  // Matching state
  const [pendingSuppliers, setPendingSuppliers] = useState<Supplier[]>([]);
  const [pendingLoading, setPendingLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<Record<number, Suggestion[]>>({});
  const [searching, setSearching] = useState<Record<number, boolean>>({});
  const [linking, setLinking] = useState<Record<number, boolean>>({});

  async function fetchSuppliers() {
    setLoading(true);
    try {
      const offset = (page - 1) * limit;
      const resp = await fetch(`/api/suppliers?limit=${limit}&offset=${offset}`);
      const data = (await resp.json()) as SuppliersResponse;
      if (data.suppliers) {
        setSuppliers(data.suppliers);
        setTotalCount(data.totalCount);
      }
    } catch (err) {
      setError("Failed to fetch suppliers");
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function fetchPendingSuppliers() {
    setPendingLoading(true);
    try {
      const resp = await fetch("/api/matching/suppliers?status=pending&limit=50");
      const data = await resp.json();
      if (data.suppliers) {
        setPendingSuppliers(data.suppliers);
      }
    } catch (err) {
      console.error("Failed to fetch pending suppliers", err);
    } finally {
      setPendingLoading(false);
    }
  }

  useEffect(() => {
    if (activeTab === "directory") {
      void fetchSuppliers();
    } else {
      void fetchPendingSuppliers();
    }
  }, [page, activeTab]);

  async function startMatching() {
    setError(null);
    setRunning(true);
    try {
      const resp = await fetch("/api/pipeline/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromStageId: "matchSuppliers",
          toStageId: "matchSuppliers",
          dryRun: false,
        }),
      });
      if (!resp.ok) {
        const data = await resp.json();
        throw new Error(data.error || "Failed to start matching process");
      }
      // Redirect to pipeline page to see logs
      window.location.href = "/pipeline";
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRunning(false);
    }
  }

  const getSuggestions = async (supplierId: number, name: string) => {
    setSearching((prev) => ({ ...prev, [supplierId]: true }));
    try {
      const resp = await fetch("/api/matching/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: name }),
      });
      const data = await resp.json();
      if (data.items) {
        setSuggestions((prev) => ({ ...prev, [supplierId]: data.items }));
      }
    } catch (err) {
      console.error("Failed to get suggestions", err);
    } finally {
      setSearching((prev) => ({ ...prev, [supplierId]: false }));
    }
  };

  const linkSupplier = async (
    supplierId: number,
    companyNumber?: string,
    confidence?: number
  ) => {
    setLinking((prev) => ({ ...prev, [supplierId]: true }));
    try {
      const resp = await fetch("/api/matching/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplierId,
          companyNumber,
          matchConfidence: confidence,
        }),
      });
      if (resp.ok) {
        setPendingSuppliers((prev) => prev.filter((s) => s.id !== supplierId));
      } else {
        const data = await resp.json();
        alert(data.error || "Failed to link supplier");
      }
    } catch (err) {
      alert("Failed to link supplier");
    } finally {
      setLinking((prev) => ({ ...prev, [supplierId]: false }));
    }
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: "GBP",
      maximumFractionDigits: 0,
    }).format(value);
  };

  const totalPages = Math.ceil(totalCount / limit);

  return (
    <div className="container mx-auto py-8 space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Suppliers</h1>
          <p className="text-muted-foreground">
            Manage and view suppliers discovered in the spending data.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center bg-muted p-1 rounded-lg">
            <Button
              variant={activeTab === "directory" ? "default" : "ghost"}
              size="sm"
              onClick={() => setActiveTab("directory")}
              className="px-4"
            >
              Directory
            </Button>
            <Button
              variant={activeTab === "matching" ? "default" : "ghost"}
              size="sm"
              onClick={() => setActiveTab("matching")}
              className="px-4"
            >
              Matching
            </Button>
          </div>
          <Button onClick={() => void startMatching()} disabled={running}>
            <Play className="mr-2 size-4" />
            {running ? "Starting..." : "Run Matching"}
          </Button>
        </div>
      </div>

      {activeTab === "directory" ? (
        <>
          <div className="grid gap-6 md:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <Users className="size-4" />
                  Total Suppliers
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{totalCount}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <TrendingUp className="size-4" />
                  Matched Suppliers
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {suppliers.filter((s) => s.matchStatus === "matched").length}
                  <span className="text-sm font-normal text-muted-foreground ml-2">
                    on this page
                  </span>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <Building2 className="size-4" />
                  Pending Review
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {suppliers.filter((s) => s.matchStatus === "pending").length}
                  <span className="text-sm font-normal text-muted-foreground ml-2">
                    on this page
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Supplier Directory</CardTitle>
              <CardDescription>
                All suppliers found in the spending datasets, ranked by total
                spend.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Supplier Name</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Companies House</TableHead>
                    <TableHead className="text-right">Total Spend</TableHead>
                    <TableHead className="text-right">Transactions</TableHead>
                    <TableHead className="w-[50px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8">
                        Loading suppliers...
                      </TableCell>
                    </TableRow>
                  ) : suppliers.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8">
                        No suppliers found.
                      </TableCell>
                    </TableRow>
                  ) : (
                    suppliers.map((s) => (
                      <TableRow key={s.id}>
                        <TableCell className="font-medium">
                          <Link
                            href={`/suppliers/${encodeURIComponent(s.name)}`}
                            className="hover:underline text-primary"
                          >
                            {s.name}
                          </Link>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              s.matchStatus === "matched"
                                ? "default"
                                : s.matchStatus === "pending"
                                ? "secondary"
                                : "outline"
                            }
                            className="capitalize"
                          >
                            {s.matchStatus.replace("_", " ")}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {s.companyName ? (
                            <div className="flex flex-col">
                              <span className="text-sm truncate max-w-[200px]">
                                {s.companyName}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {s.companyNumber}
                              </span>
                            </div>
                          ) : (
                            <span className="text-muted-foreground text-sm italic">
                              Not linked
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatCurrency(s.totalSpend || 0)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {s.transactionCount || 0}
                        </TableCell>
                        <TableCell>
                          <Button variant="ghost" size="icon" asChild>
                            <Link
                              href={`/suppliers/${encodeURIComponent(s.name)}`}
                            >
                              <ExternalLink className="size-4" />
                            </Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>

              {totalPages > 1 && (
                <div className="flex items-center justify-end space-x-2 pt-4">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1 || loading}
                  >
                    <ChevronLeft className="size-4 mr-1" />
                    Previous
                  </Button>
                  <div className="text-sm font-medium">
                    Page {page} of {totalPages}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages || loading}
                  >
                    Next
                    <ChevronRight className="size-4 ml-1" />
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Unmatched Suppliers</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void fetchPendingSuppliers()}
                disabled={pendingLoading}
              >
                <RefreshCw
                  className={cn(
                    "mr-2 size-4",
                    pendingLoading && "animate-spin"
                  )}
                />
                Refresh
              </Button>
            </CardTitle>
            <CardDescription>
              These suppliers have been discovered but not yet linked to a
              Companies House entity.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Supplier Name</TableHead>
                  <TableHead>Match Suggestions</TableHead>
                  <TableHead className="w-[150px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pendingLoading ? (
                  <TableRow>
                    <TableCell colSpan={3} className="h-24 text-center">
                      <Loader2 className="size-6 animate-spin mx-auto text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                ) : pendingSuppliers.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={3}
                      className="h-24 text-center text-muted-foreground"
                    >
                      No unmatched suppliers found.
                    </TableCell>
                  </TableRow>
                ) : (
                  pendingSuppliers.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-medium">{s.name}</TableCell>
                      <TableCell>
                        {suggestions[s.id] ? (
                          <div className="space-y-2">
                            {suggestions[s.id].map((sub) => (
                              <div
                                key={sub.company_number}
                                className="flex items-center justify-between gap-4 p-2 rounded-md border bg-muted/30 text-xs"
                              >
                                <div className="flex flex-col">
                                  <span className="font-semibold">
                                    {sub.title}
                                  </span>
                                  <span className="text-muted-foreground">
                                    #{sub.company_number} • {sub.company_status}
                                  </span>
                                </div>
                                <div className="flex gap-1">
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-8 w-8 p-0"
                                    onClick={() =>
                                      window.open(
                                        `https://find-and-update.company-information.service.gov.uk/company/${sub.company_number}`,
                                        "_blank"
                                      )
                                    }
                                  >
                                    <ExternalLink className="size-3" />
                                  </Button>
                                  <Button
                                    size="sm"
                                    className="h-8 bg-emerald-600 hover:bg-emerald-700"
                                    onClick={() =>
                                      void linkSupplier(s.id, sub.company_number)
                                    }
                                    disabled={linking[s.id]}
                                  >
                                    {linking[s.id] ? (
                                      <Loader2 className="size-3 animate-spin" />
                                    ) : (
                                      <Check className="size-3" />
                                    )}
                                    Match
                                  </Button>
                                </div>
                              </div>
                            ))}
                            {suggestions[s.id].length === 0 && (
                              <span className="text-xs text-muted-foreground italic">
                                No suggestions found
                              </span>
                            )}
                          </div>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-xs h-8"
                            onClick={() => void getSuggestions(s.id, s.name)}
                            disabled={searching[s.id]}
                          >
                            {searching[s.id] ? (
                              <Loader2 className="size-3 animate-spin mr-2" />
                            ) : (
                              <Search className="size-3 mr-2" />
                            )}
                            Find Suggestions
                          </Button>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-xs h-8 text-destructive hover:text-destructive"
                            onClick={() => void linkSupplier(s.id)}
                            disabled={linking[s.id]}
                          >
                            No Match
                          </Button>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 p-0"
                              >
                                <MoreHorizontal className="size-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuLabel>Manual Entry</DropdownMenuLabel>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={() => {
                                  const num = prompt("Enter Company Number:");
                                  if (num) void linkSupplier(s.id, num);
                                }}
                              >
                                Enter Company ID...
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

