"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Search, Building2, Building, Landmark, Gavel, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type EntityType = "company" | "nhs_trust" | "council" | "government_department";

interface EntityLinkerProps {
  entityName: string;
  entityId: number;
  entityKind?: "supplier" | "buyer";
  onLinked?: () => void;
  buttonVariant?: "default" | "outline" | "ghost" | "link";
  buttonSize?: "default" | "sm" | "lg" | "icon";
  buttonText?: string;
  initialType?: EntityType;
}

const ENTITY_TYPES: { id: EntityType; label: string; icon: any }[] = [
  { id: "company", label: "Company", icon: Building2 },
  { id: "nhs_trust", label: "NHS Org", icon: Building },
  { id: "council", label: "Council", icon: Landmark },
  { id: "government_department", label: "Gov Dept", icon: Gavel },
];

export function EntityLinker({
  entityName,
  entityId,
  entityKind = "supplier",
  onLinked,
  buttonVariant = "outline",
  buttonSize = "sm",
  buttonText = "Link",
  initialType = "company",
}: EntityLinkerProps) {
  const router = useRouter();
  const [showModal, setShowModal] = useState(false);
  const [activeType, setActiveType] = useState<EntityType>(initialType);
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<any[]>([]);
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState(entityName);

  const searchEntities = async (type: EntityType, query: string) => {
    setIsSearching(true);
    try {
      const res = await fetch("/api/matching/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, supplierName: entityName, type }),
      });
      if (res.ok) {
        const data = await res.json();
        setResults(data.items || []);
      } else {
        setResults([]);
      }
    } catch (err) {
      console.error("Search failed:", err);
      setResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  useEffect(() => {
    if (showModal) {
      searchEntities(activeType, searchQuery);
    }
  }, [showModal, activeType]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    searchEntities(activeType, searchQuery);
  };

  const linkEntity = async (item: any) => {
    const identifier = 
      activeType === "company" ? item.company_number :
      activeType === "nhs_trust" ? item.ods_code :
      activeType === "council" ? item.gss_code :
      activeType === "government_department" ? item.slug : null;

    setLinkingId(identifier);
    try {
      const payload: any = {
        type: activeType,
        identifier,
        matchConfidence: item.similarity,
        metadata: item.metadata || item.profile || item.org || item
      };

      if (entityKind === "buyer") {
        payload.buyerId = entityId;
      } else {
        payload.supplierId = entityId;
      }

      const res = await fetch("/api/matching/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setShowModal(false);
        router.refresh();
        if (onLinked) onLinked();
      }
    } catch (err) {
      console.error("Linking failed:", err);
    } finally {
      setLinkingId(null);
    }
  };

  return (
    <>
      <Button
        variant={buttonVariant}
        size={buttonSize}
        onClick={() => {
          setSearchQuery(entityName);
          setShowModal(true);
        }}
        className="gap-1"
      >
        <Search className="size-3" />
        {buttonText}
      </Button>

      {showModal && (
        <div 
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-[1000] p-4"
          onClick={() => setShowModal(false)}
        >
          <div 
            className="bg-white rounded-xl max-w-2xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-5 border-b">
              <h2 className="text-lg font-semibold text-zinc-900">Link {entityKind === "buyer" ? "Buyer" : "Supplier"} to Entity</h2>
              <button
                onClick={() => setShowModal(false)}
                className="text-2xl text-zinc-400 hover:text-zinc-600 transition-colors"
              >
                ×
              </button>
            </div>

            <div className="border-b bg-zinc-50/50 p-2 flex gap-1">
              {ENTITY_TYPES.map((type) => (
                <button
                  key={type.id}
                  onClick={() => setActiveType(type.id)}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                    activeType === type.id
                      ? "bg-white text-primary shadow-sm"
                      : "text-zinc-500 hover:text-zinc-700 hover:bg-zinc-100"
                  )}
                >
                  <type.icon className="size-4" />
                  {type.label}
                </button>
              ))}
            </div>
            
            <div className="p-4 border-b">
              <form onSubmit={handleSearch} className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-zinc-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-4 py-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                    placeholder="Search entities..."
                  />
                </div>
                <Button type="submit" size="sm" disabled={isSearching}>
                  {isSearching ? <Loader2 className="size-4 animate-spin" /> : "Search"}
                </Button>
              </form>
            </div>

            <div className="p-6 overflow-auto flex-1">
              {isSearching ? (
                <div className="py-12 text-center text-zinc-500">
                  <Loader2 className="size-8 animate-spin mx-auto mb-4 text-zinc-300" />
                  Searching...
                </div>
              ) : results.length === 0 ? (
                <div className="py-12 text-center text-zinc-500">
                  No entities found
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {results.map((item, idx) => {
                    const id = 
                      activeType === "company" ? item.company_number :
                      activeType === "nhs_trust" ? item.ods_code :
                      activeType === "council" ? item.gss_code :
                      activeType === "government_department" ? item.slug : idx;
                    
                    return (
                      <div 
                        key={id} 
                        className="p-4 border border-zinc-100 rounded-lg flex justify-between items-center bg-zinc-50/50 hover:bg-zinc-50 transition-colors"
                      >
                        <div className="flex-1 mr-4">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-semibold text-zinc-900 text-sm">
                              {item.title}
                            </span>
                            {item.similarity !== undefined && (
                              <Badge 
                                className={cn(
                                  "text-[10px] px-1.5 py-0 h-4",
                                  item.similarity > 0.8 
                                    ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-100" 
                                    : item.similarity > 0.5 
                                      ? "bg-amber-100 text-amber-700 hover:bg-amber-100" 
                                      : "bg-zinc-100 text-zinc-600 hover:bg-zinc-100"
                                )}
                              >
                                {Math.round(item.similarity * 100)}% match
                              </Badge>
                            )}
                          </div>
                          <div className="text-xs text-zinc-500 mb-1 flex items-center gap-2 flex-wrap">
                            <span className="font-mono text-[10px] bg-zinc-100 px-1 rounded">{id}</span>
                            <span>•</span>
                            <span className="font-medium">
                              {activeType === "company" ? item.company_status : 
                               activeType === "council" ? item.council_type : 
                               activeType === "government_department" ? item.organisation_type : 
                               "Active"}
                            </span>
                            {item.primary_role && (
                              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 font-semibold">
                                {item.primary_role}
                              </Badge>
                            )}
                          </div>
                          {item.address_snippet && (
                            <div className="text-xs text-zinc-400 leading-tight">
                              {item.address_snippet}
                            </div>
                          )}
                        </div>
                        <Button
                          size="sm"
                          onClick={() => linkEntity(item)}
                          disabled={linkingId === id}
                        >
                          {linkingId === id ? "Linking..." : "Link"}
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

