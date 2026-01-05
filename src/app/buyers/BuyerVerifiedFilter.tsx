"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export function BuyerVerifiedFilter() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();

  const currentVerified = searchParams.get("verified") || "";

  const setFilter = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set("verified", value);
    } else {
      params.delete("verified");
    }
    // Reset page when filtering
    params.delete("page");
    router.push(`${pathname}?${params.toString()}`);
  };

  const options = [
    { label: "All Buyers", value: "" },
    { label: "Verified Only", value: "true" },
    { label: "Unverified Only", value: "false" },
  ];

  return (
    <div className="flex bg-zinc-100 p-1 rounded-lg w-fit mb-4">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => setFilter(opt.value)}
          className={cn(
            "px-4 py-1.5 rounded-md text-sm font-medium transition-all",
            currentVerified === opt.value
              ? "bg-white text-zinc-900 shadow-sm"
              : "text-zinc-500 hover:text-zinc-700 hover:bg-zinc-50/50"
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

