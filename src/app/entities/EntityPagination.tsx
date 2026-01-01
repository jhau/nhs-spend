"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface EntityPaginationProps {
  page: number;
  totalPages: number;
}

export function EntityPagination({ page, totalPages }: EntityPaginationProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const setPage = (p: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("page", p.toString());
    router.push(`?${params.toString()}`);
  };

  if (totalPages <= 1) return null;

  return (
    <div className="flex items-center justify-end space-x-2 pt-4 border-t mt-4">
      <Button
        variant="outline"
        size="sm"
        onClick={() => setPage(Math.max(1, page - 1))}
        disabled={page === 1}
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
        onClick={() => setPage(Math.min(totalPages, page + 1))}
        disabled={page === totalPages}
      >
        Next
        <ChevronRight className="size-4 ml-1" />
      </Button>
    </div>
  );
}

