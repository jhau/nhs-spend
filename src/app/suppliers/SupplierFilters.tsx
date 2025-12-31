"use client";

import { Search, Play } from "lucide-react";
import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";

interface SupplierFiltersProps {
  statusFilter: string;
  searchFilter: string;
  onMatchPending: () => void;
  isMatchingRunning: boolean;
}

export function SupplierFilters({ 
  statusFilter, 
  searchFilter, 
  onMatchPending,
  isMatchingRunning 
}: SupplierFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [searchInput, setSearchInput] = useState(searchFilter);

  useEffect(() => {
    setSearchInput(searchFilter);
  }, [searchFilter]);

  const updateParam = (key: string, value: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("page", "1");
    if (value === null || value === "" || value === "all") {
      params.delete(key);
    } else {
      params.set(key, value);
    }
    router.push(`?${params.toString()}`);
  };

  return (
    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
      <div className="flex items-center gap-2 max-w-sm w-full">
        <div className="relative w-full">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <input
            type="search"
            placeholder="Search suppliers by name..."
            className="flex h-10 w-full rounded-md border border-input bg-background px-9 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                updateParam("search", searchInput);
              }
            }}
          />
        </div>
        <Button onClick={() => updateParam("search", searchInput)}>
          Search
        </Button>
      </div>

      <div className="flex items-center gap-2 bg-muted p-1 rounded-lg text-xs">
        <div className="flex items-center mr-2 border-r pr-2 gap-1">
          {["all", "matched", "pending"].map((status) => (
            <Button
              key={status}
              variant={statusFilter === status ? "default" : "ghost"}
              size="sm"
              onClick={() => updateParam("status", status)}
              className="h-8 px-3 text-xs capitalize"
            >
              {status}
            </Button>
          ))}
        </div>
        <Button
          onClick={onMatchPending}
          disabled={isMatchingRunning}
          size="sm"
          className="h-8 px-3 text-xs"
        >
          <Play className="mr-2 size-3" />
          {isMatchingRunning ? "Starting..." : "Match Page Pending"}
        </Button>
      </div>
    </div>
  );
}

