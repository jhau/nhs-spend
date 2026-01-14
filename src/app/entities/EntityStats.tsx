"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LayoutGrid, Building2, Landmark, Hospital, Briefcase, Loader2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { useState, useTransition } from "react";

interface EntityStatsProps {
  counts: {
    total: number;
    company: number;
    nhs: number;
    council: number;
    government_department: number;
  };
}

export function EntityStats({ counts }: EntityStatsProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeType = searchParams.get("type") || "all";
  const [isPending, startTransition] = useTransition();
  const [loadingType, setLoadingType] = useState<string | null>(null);

  const setType = (type: string) => {
    setLoadingType(type);
    startTransition(() => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("type", type);
      params.set("page", "1");
      router.push(`?${params.toString()}`);
    });
  };

  const stats = [
    {
      label: "Total Entities",
      value: counts.total,
      type: "all",
      icon: LayoutGrid,
    },
    {
      label: "Companies",
      value: counts.company,
      type: "company",
      icon: Building2,
    },
    {
      label: "NHS Organisations",
      value: counts.nhs,
      type: "nhs",
      icon: Hospital,
    },
    {
      label: "Government",
      value: counts.government_department,
      type: "government_department",
      icon: Briefcase,
    },
    {
      label: "Councils",
      value: counts.council,
      type: "council",
      icon: Landmark,
    },
  ];

  return (
    <div className="grid gap-6 md:grid-cols-3 lg:grid-cols-5">
      {stats.map((stat) => {
        const isActive = 
          activeType === stat.type || 
          (stat.type === 'nhs' && activeType.startsWith('nhs_'));

        return (
          <Card
            key={stat.type}
            className={cn(
              "cursor-pointer transition-colors hover:bg-muted/50 relative",
              isActive && "ring-2 ring-[#2D213F]",
              isPending && loadingType === stat.type && "opacity-70"
            )}
            onClick={() => setType(stat.type)}
          >
            {isPending && loadingType === stat.type && (
              <div className="absolute top-2 right-2">
                <Loader2 className="size-3 animate-spin text-muted-foreground" />
              </div>
            )}
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <stat.icon className="size-4" />
                {stat.label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stat.value.toLocaleString()}</div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

