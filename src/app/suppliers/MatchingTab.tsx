"use client";

import { useEffect, useState } from "react";
import { 
  Play, 
  RefreshCw, 
  Loader2, 
  Search, 
  ExternalLink, 
  Check, 
  Building2, 
  Landmark, 
  MoreHorizontal 
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { 
  DropdownMenu, 
  DropdownMenuTrigger, 
  DropdownMenuContent, 
  DropdownMenuLabel, 
  DropdownMenuSeparator, 
  DropdownMenuItem 
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

interface Suggestion {
  company_number: string;
  title: string;
  company_status: string;
  company_type: string;
}

interface PendingSupplier {
  id: number;
  name: string;
}

interface MatchingTabProps {
  initialSuppliers: PendingSupplier[];
  searchFilter: string;
  onMatchPending: (ids: number[]) => void;
  isMatchingRunning: boolean;
}

export function MatchingTab({ 
  initialSuppliers, 
  searchFilter, 
  onMatchPending,
  isMatchingRunning 
}: MatchingTabProps) {
  const [suppliers, setSuppliers] = useState(initialSuppliers);
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<Record<number, Suggestion[]>>({});
  const [searching, setSearching] = useState<Record<number, boolean>>({});
  const [linking, setLinking] = useState<Record<number, boolean>>({});
  const [matching, setMatching] = useState<Record<number, boolean>>({});

  const fetchPendingSuppliers = async () => {
    setLoading(true);
    try {
      const searchParam = searchFilter ? `&search=${encodeURIComponent(searchFilter)}` : "";
      const resp = await fetch(`/api/matching/suppliers?status=pending&limit=100${searchParam}`);
      const data = await resp.json();
      setSuppliers(data.suppliers || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

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
      console.error(err);
    } finally {
      setSearching((prev) => ({ ...prev, [supplierId]: false }));
    }
  };

  const linkSupplier = async (supplierId: number, companyNumber?: string, confidence?: number) => {
    setLinking((prev) => ({ ...prev, [supplierId]: true }));
    try {
      const resp = await fetch("/api/matching/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ supplierId, companyNumber, matchConfidence: confidence }),
      });
      if (resp.ok) {
        setSuppliers((prev) => prev.filter((s) => s.id !== supplierId));
      } else {
        const data = await resp.json();
        alert(data.error || "Failed to link supplier");
      }
    } catch (err) {
      alert("Failed to link");
    } finally {
      setLinking((prev) => ({ ...prev, [supplierId]: false }));
    }
  };

  const matchSingleSupplier = async (supplierId: number, type: "company" | "council") => {
    setMatching((prev) => ({ ...prev, [supplierId]: true }));
    try {
      const resp = await fetch("/api/matching/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ supplierId, type }),
      });
      if (resp.ok) {
        setSuppliers((prev) => prev.filter((s) => s.id !== supplierId));
      } else {
        const data = await resp.json();
        alert(data.error || `Failed to match ${type}`);
      }
    } catch (err) {
      alert(`Failed to match ${type}`);
    } finally {
      setMatching((prev) => ({ ...prev, [supplierId]: false }));
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Review Pending Suppliers ({suppliers.length})</span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onMatchPending(suppliers.map(s => s.id))}
              disabled={isMatchingRunning}
            >
              <Play className={cn("mr-2 size-4", isMatchingRunning && "animate-spin")} />
              {isMatchingRunning ? "Starting..." : "Match Page Pending"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={fetchPendingSuppliers}
              disabled={loading}
            >
              <RefreshCw className={cn("mr-2 size-4", loading && "animate-spin")} />
              Refresh
            </Button>
          </div>
        </CardTitle>
        <CardDescription>
          These suppliers have been discovered but not yet linked to an entity.
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
            {loading ? (
              <TableRow>
                <TableCell colSpan={3} className="h-24 text-center">
                  <Loader2 className="size-6 animate-spin mx-auto text-muted-foreground" />
                </TableCell>
              </TableRow>
            ) : suppliers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="h-24 text-center text-muted-foreground">
                  No unmatched suppliers found.
                </TableCell>
              </TableRow>
            ) : (
              suppliers.map((s) => (
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
                              <span className="font-semibold">{sub.title}</span>
                              <span className="text-muted-foreground">
                                #{sub.company_number} • {sub.company_status}
                              </span>
                            </div>
                            <div className="flex gap-1">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-8 w-8 p-0"
                                onClick={() => window.open(`https://find-and-update.company-information.service.gov.uk/company/${sub.company_number}`, "_blank")}
                              >
                                <ExternalLink className="size-3" />
                              </Button>
                              <Button
                                size="sm"
                                className="h-8 bg-emerald-600 hover:bg-emerald-700"
                                onClick={() => linkSupplier(s.id, sub.company_number)}
                                disabled={linking[s.id]}
                              >
                                {linking[s.id] ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
                                Match
                              </Button>
                            </div>
                          </div>
                        ))}
                        {suggestions[s.id].length === 0 && (
                          <span className="text-xs text-muted-foreground italic">No suggestions found</span>
                        )}
                      </div>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-xs h-8"
                        onClick={() => getSuggestions(s.id, s.name)}
                        disabled={searching[s.id]}
                      >
                        {searching[s.id] ? <Loader2 className="size-3 animate-spin mr-2" /> : <Search className="size-3 mr-2" />}
                        Find Suggestions
                      </Button>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs h-8"
                        onClick={() => matchSingleSupplier(s.id, "company")}
                        disabled={matching[s.id]}
                      >
                        {matching[s.id] ? <Loader2 className="size-3 animate-spin mr-1" /> : <Building2 className="size-3 mr-1" />}
                        Match Co
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs h-8"
                        onClick={() => matchSingleSupplier(s.id, "council")}
                        disabled={matching[s.id]}
                      >
                        {matching[s.id] ? <Loader2 className="size-3 animate-spin mr-1" /> : <Landmark className="size-3 mr-1" />}
                        Match Council
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuLabel>Manual Entry</DropdownMenuLabel>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => {
                            const num = prompt("Enter Company Number:");
                            if (num) linkSupplier(s.id, num);
                          }}>
                            Enter Company ID...
                          </DropdownMenuItem>
                          <DropdownMenuItem className="text-destructive" onClick={() => linkSupplier(s.id)}>
                            No Match
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
  );
}

