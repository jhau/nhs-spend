"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";

const ENTITY_TYPES = [
  { label: "All", value: "all" },
  { label: "Companies", value: "company" },
  { label: "NHS Trusts", value: "nhs_trust" },
  { label: "NHS ICBs", value: "nhs_icb" },
  { label: "Government", value: "government_department" },
  { label: "Councils", value: "council" },
  { label: "Other", value: "other" },
];

interface EntityDirectoryFiltersProps {
  typeFilter: string;
}

export function EntityDirectoryFilters({ 
  typeFilter 
}: EntityDirectoryFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const setType = (type: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("type", type);
    params.set("page", "1");
    router.push(`?${params.toString()}`);
  };

  return (
    <div className="flex items-center gap-1 bg-muted p-1 rounded-lg text-xs">
      {ENTITY_TYPES.map((t) => (
        <Button
          key={t.value}
          variant={typeFilter === t.value ? "default" : "ghost"}
          size="sm"
          onClick={() => setType(t.value)}
          className="h-8 px-3 text-xs"
        >
          {t.label}
        </Button>
      ))}
    </div>
  );
}

