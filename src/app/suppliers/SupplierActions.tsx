"use client";

import { useState } from "react";
import { MoreHorizontal, Building2, Landmark, ExternalLink } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface SupplierActionsProps {
  supplierId: number;
  matchStatus: string;
}

export function SupplierActions({ supplierId, matchStatus }: SupplierActionsProps) {
  const [matching, setMatching] = useState(false);

  const matchSingleSupplier = async (type: "company" | "council") => {
    setMatching(true);
    try {
      const resp = await fetch("/api/matching/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ supplierId, type }),
      });
      if (resp.ok) {
        window.location.reload();
      } else {
        const data = await resp.json();
        alert(data.error || `Failed to match ${type}`);
      }
    } catch (err) {
      alert(`Failed to match ${type}`);
    } finally {
      setMatching(false);
    }
  };

  return (
    <div className="flex items-center justify-end gap-1">
      {matchStatus !== "matched" && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Actions</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => void matchSingleSupplier("company")}
              disabled={matching}
            >
              <Building2 className="mr-2 size-4" />
              Match Company
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => void matchSingleSupplier("council")}
              disabled={matching}
            >
              <Landmark className="mr-2 size-4" />
              Match Council
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
        <Link href={`/suppliers/${supplierId}`}>
          <ExternalLink className="size-4" />
        </Link>
      </Button>
    </div>
  );
}

