"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, TrendingUp, Building2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

interface SupplierTabsProps {
  totalCount: number;
  matchedCount: number;
  pendingCount: number;
}

export function SupplierTabs({
  totalCount,
  matchedCount,
  pendingCount,
}: SupplierTabsProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTab = searchParams.get("tab") || "directory";

  const setTab = (tab: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", tab);
    params.set("page", "1");
    router.push(`?${params.toString()}`);
  };

  return (
    <div className="grid gap-6 md:grid-cols-3">
      <Card
        className={cn(
          "cursor-pointer transition-colors hover:bg-muted/50",
          activeTab === "directory" && "ring-2 ring-primary"
        )}
        onClick={() => setTab("directory")}
      >
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
      <Card
        className={cn(
          "cursor-pointer transition-colors hover:bg-muted/50",
          activeTab === "matched" && "ring-2 ring-primary"
        )}
        onClick={() => setTab("matched")}
      >
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <TrendingUp className="size-4" />
            Matched Suppliers
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{matchedCount}</div>
        </CardContent>
      </Card>
      <Card
        className={cn(
          "cursor-pointer transition-colors hover:bg-muted/50",
          activeTab === "matching" && "ring-2 ring-primary"
        )}
        onClick={() => setTab("matching")}
      >
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <Building2 className="size-4" />
            Pending Review
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{pendingCount}</div>
        </CardContent>
      </Card>
    </div>
  );
}
