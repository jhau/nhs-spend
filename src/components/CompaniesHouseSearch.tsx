"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface CompanySearchResult {
  company_number: string;
  title: string;
  company_status: string;
  company_type: string;
  date_of_creation?: string;
  address_snippet?: string;
  similarity?: number;
}

interface CompaniesHouseSearchProps {
  supplierName: string;
  supplierId: number;
  onLinked?: () => void;
  buttonVariant?: "default" | "outline" | "ghost" | "link";
  buttonSize?: "default" | "sm" | "lg" | "icon";
  buttonText?: string;
}

export function CompaniesHouseSearch({
  supplierName,
  supplierId,
  onLinked,
  buttonVariant = "outline",
  buttonSize = "sm",
  buttonText = "Link Company",
}: CompaniesHouseSearchProps) {
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [isSearchingCompanies, setIsSearchingCompanies] = useState(false);
  const [companySearchResults, setCompanySearchResults] = useState<CompanySearchResult[]>([]);
  const [linkingCompany, setLinkingCompany] = useState<string | null>(null);

  const searchCompaniesHouse = async () => {
    setIsSearchingCompanies(true);
    setShowSearchModal(true);
    try {
      const res = await fetch("/api/matching/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: supplierName, supplierName }),
      });
      if (res.ok) {
        const data = await res.json();
        setCompanySearchResults(data.items || []);
      }
    } catch (err) {
      console.error("Search failed:", err);
    } finally {
      setIsSearchingCompanies(false);
    }
  };

  const linkCompany = async (company: CompanySearchResult) => {
    setLinkingCompany(company.company_number);
    try {
      const res = await fetch("/api/matching/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplierId,
          companyNumber: company.company_number,
          matchConfidence: company.similarity,
        }),
      });
      if (res.ok) {
        setShowSearchModal(false);
        if (onLinked) onLinked();
      }
    } catch (err) {
      console.error("Linking failed:", err);
    } finally {
      setLinkingCompany(null);
    }
  };

  return (
    <>
      <Button
        variant={buttonVariant}
        size={buttonSize}
        onClick={searchCompaniesHouse}
        className="gap-1"
      >
        <Search className="size-3" />
        {buttonText}
      </Button>

      {showSearchModal && (
        <div 
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-[1000] p-4"
          onClick={() => setShowSearchModal(false)}
        >
          <div 
            className="bg-white rounded-xl max-w-2xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-5 border-b">
              <h2 className="text-lg font-semibold text-zinc-900">Search Companies House</h2>
              <button
                onClick={() => setShowSearchModal(false)}
                className="text-2xl text-zinc-400 hover:text-zinc-600 transition-colors"
              >
                ×
              </button>
            </div>
            
            <div className="p-6 overflow-auto flex-1">
              <div className="text-sm text-zinc-600 mb-4">
                Searching for: <strong className="text-zinc-900">{supplierName}</strong>
              </div>

              {isSearchingCompanies ? (
                <div className="py-12 text-center text-zinc-500">
                  Searching Companies House...
                </div>
              ) : companySearchResults.length === 0 ? (
                <div className="py-12 text-center text-zinc-500">
                  No companies found
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {companySearchResults.map((company) => (
                    <div 
                      key={company.company_number} 
                      className="p-4 border border-zinc-100 rounded-lg flex justify-between items-center bg-zinc-50/50 hover:bg-zinc-50 transition-colors"
                    >
                      <div className="flex-1 mr-4">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-semibold text-zinc-900 text-sm">
                            {company.title}
                          </span>
                          {company.similarity !== undefined && (
                            <Badge 
                              className={cn(
                                "text-[10px] px-1.5 py-0 h-4",
                                company.similarity > 0.8 
                                  ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-100" 
                                  : company.similarity > 0.5 
                                    ? "bg-amber-100 text-amber-700 hover:bg-amber-100" 
                                    : "bg-zinc-100 text-zinc-600 hover:bg-zinc-100"
                              )}
                            >
                              {Math.round(company.similarity * 100)}% match
                            </Badge>
                          )}
                        </div>
                        <div className="text-xs text-zinc-500 mb-1">
                          {company.company_number} • {company.company_status} • {company.company_type}
                        </div>
                        {company.address_snippet && (
                          <div className="text-xs text-zinc-400 leading-tight">
                            {company.address_snippet}
                          </div>
                        )}
                      </div>
                      <Button
                        size="sm"
                        onClick={() => linkCompany(company)}
                        disabled={linkingCompany === company.company_number}
                      >
                        {linkingCompany === company.company_number ? "Linking..." : "Link"}
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

