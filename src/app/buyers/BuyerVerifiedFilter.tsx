"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useTransition } from "react";
import { Loader2 } from "lucide-react";

interface VerificationStats {
  all: number;
  verified: number;
  unverified: number;
}

export function BuyerVerifiedFilter({ stats }: { stats?: VerificationStats }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  const currentVerified = searchParams.get("verified") || "";

  const setFilter = (value: string) => {
    startTransition(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) {
        params.set("verified", value);
      } else {
        params.delete("verified");
      }
      // Reset page when filtering
      params.delete("page");
      router.push(`${pathname}?${params.toString()}`);
    });
  };

  const options = [
    { label: "All", value: "", count: stats?.all },
    { label: "Verified", value: "true", count: stats?.verified },
    { label: "Unverified", value: "false", count: stats?.unverified },
  ];

  return (
    <div className="flex items-center gap-3 mb-4">
      <div className="flex bg-zinc-100 p-1 rounded-lg w-fit">
        {options.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setFilter(opt.value)}
            disabled={isPending}
            className={cn(
              "px-4 py-1.5 rounded-md text-sm font-medium transition-all flex items-center gap-2",
              currentVerified === opt.value
                ? "bg-white text-zinc-900 shadow-sm"
                : "text-zinc-500 hover:text-zinc-700 hover:bg-zinc-50/50",
              isPending && "opacity-50 cursor-not-allowed"
            )}
          >
            <span>{opt.label}</span>
            {opt.count !== undefined && (
              <span
                className={cn(
                  "text-[10px] px-1.5 py-0.5 rounded-full",
                  currentVerified === opt.value
                    ? "bg-zinc-100 text-zinc-600"
                    : "bg-zinc-200/50 text-zinc-500"
                )}
              >
                {opt.count.toLocaleString()}
              </span>
            )}
          </button>
        ))}
      </div>
      {isPending && <Loader2 className="w-4 h-4 animate-spin text-zinc-500" />}
    </div>
  );
}
