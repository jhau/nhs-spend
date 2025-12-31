"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Play } from "lucide-react";
import { useState } from "react";

interface SupplierDirectoryFiltersProps {
  statusFilter: string;
  hasPendingSuppliers: boolean;
  pendingSupplierIds: number[];
}

export function SupplierDirectoryFilters({ 
  statusFilter, 
  hasPendingSuppliers, 
  pendingSupplierIds 
}: SupplierDirectoryFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [running, setRunning] = useState(false);

  const setStatus = (status: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("status", status);
    params.set("page", "1");
    router.push(`?${params.toString()}`);
  };

  async function startMatching() {
    setRunning(true);
    try {
      const resp = await fetch("/api/pipeline/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromStageId: "matchSuppliers",
          toStageId: "matchSuppliers",
          dryRun: false,
          params: { supplierIds: pendingSupplierIds },
        }),
      });
      if (!resp.ok) {
        const data = await resp.json();
        throw new Error(data.error || "Failed to start matching process");
      }
      window.location.href = "/pipeline";
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
      setRunning(false);
    }
  }

  return (
    <div className="flex items-center gap-2 bg-muted p-1 rounded-lg text-xs">
      <div className="flex items-center mr-2 border-r pr-2 gap-1">
        {["all", "matched", "pending"].map((s) => (
          <Button
            key={s}
            variant={statusFilter === s ? "default" : "ghost"}
            size="sm"
            onClick={() => setStatus(s)}
            className="h-8 px-3 text-xs capitalize"
          >
            {s}
          </Button>
        ))}
      </div>
      <Button
        onClick={startMatching}
        disabled={running || !hasPendingSuppliers}
        size="sm"
        className="h-8 px-3 text-xs"
      >
        <Play className="mr-2 size-3" />
        {running ? "Starting..." : "Match Page Pending"}
      </Button>
    </div>
  );
}

