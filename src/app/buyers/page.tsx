import { getBuyersData } from "@/lib/data/buyers";
import { EntityLinker } from "@/components/EntityLinker";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { BuyerSearch } from "./BuyerSearch";
import { BuyerDateRange } from "./BuyerDateRange";
import { getDefaultDateRange } from "@/lib/utils";
import { BuyerPagination } from "./BuyerPagination";
import { BuyerVerifiedFilter } from "./BuyerVerifiedFilter";
import { Suspense } from "react";

interface Buyer {
  id: number;
  buyer_name: string;
  entity_name: string | null;
  entity_id: number | null;
  display_type: string | null;
  ods_code: string | null;
  total_spend: string;
  supplier_count: number;
  top_supplier: string | null;
  top_supplier_id: number | null;
  match_status: string;
}

function formatCurrency(amount: number): string {
  if (amount >= 1_000_000_000) {
    return `£${(amount / 1_000_000_000).toFixed(2)}B`;
  }
  if (amount >= 1_000_000) {
    return `£${(amount / 1_000_000).toFixed(0)}M`;
  }
  if (amount >= 1_000) {
    return `£${(amount / 1_000).toFixed(0)}K`;
  }
  return `£${amount.toFixed(0)}`;
}

function formatNumber(num: number): string {
  return num.toLocaleString("en-GB");
}

export default async function BuyersPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sParams = await searchParams;
  const currentPage = parseInt((sParams.page as string) || "1", 10);
  const search = (sParams.search as string) || "";
  const verified = (sParams.verified as string) || "";

  const defaultDates = getDefaultDateRange();
  const startDate = (sParams.startDate as string) || defaultDates.startDate;
  const endDate = (sParams.endDate as string) || defaultDates.endDate;

  const { buyers, typeStats, pagination } = await getBuyersData({
    page: currentPage,
    limit: 20,
    search,
    startDate,
    endDate,
    verified,
  });

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <h1 style={styles.title}>Spend Data - Buyers</h1>
        <div style={styles.headerRow}>
          <BuyerDateRange />
        </div>
      </div>

      {/* Type Stats Section */}
      <div style={styles.summarySection}>
        <h2 style={styles.sectionTitle}>Buyer Categories</h2>
        <div style={styles.summaryGrid}>
          {typeStats.map((stat: any) => {
            const href =
              stat.type === "NHS Orgs"
                ? "/buyers/nhs"
                : stat.type === "Government Departments"
                ? "/buyers/gov"
                : stat.type === "Councils"
                ? "/buyers/councils"
                : undefined;

            return (
              <SummaryCard
                key={stat.type}
                value={formatCurrency(parseFloat(stat.total_spend))}
                label={`${stat.type} (${formatNumber(
                  stat.buyer_count
                )} buyers)`}
                href={href}
              />
            );
          })}
        </div>
      </div>

      {/* Search */}
      <BuyerSearch />

      <Suspense
        fallback={
          <div className="h-10 mb-4 animate-pulse bg-zinc-100 rounded-lg w-64" />
        }
      >
        <BuyerVerifiedFilter />
      </Suspense>

      {/* Data Table */}
      <div style={styles.tableContainer}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Buyer</th>
              <th style={styles.th}>Status</th>
              <th style={styles.th}>ODS Code</th>
              <th style={styles.th}>Linked Entity</th>
              <th style={styles.th}>Type</th>
              <th style={{ ...styles.th, textAlign: "right" }}>Total Spend</th>
              <th style={styles.th}>Top Supplier</th>
              <th style={{ ...styles.th, textAlign: "center" }}>
                # of Suppliers
              </th>
            </tr>
          </thead>
          <tbody>
            {buyers.length === 0 ? (
              <tr>
                <td colSpan={7} style={styles.emptyCell}>
                  No buyers found
                </td>
              </tr>
            ) : (
              buyers.map((buyer: Buyer) => (
                <tr key={buyer.id} style={styles.tr}>
                  <td style={styles.td}>
                    <Link href={`/buyers/${buyer.id}`} style={styles.buyerName}>
                      {buyer.buyer_name}
                    </Link>
                  </td>
                  <td style={styles.td}>
                    <Badge
                      variant={
                        buyer.match_status === "matched"
                          ? "default"
                          : buyer.match_status === "pending_review"
                          ? "secondary"
                          : "outline"
                      }
                      className={cn(
                        "text-[10px] px-1.5 py-0 h-4 uppercase font-semibold",
                        buyer.match_status === "matched"
                          ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-100 border-none"
                          : buyer.match_status === "pending_review"
                          ? "bg-amber-100 text-amber-700 hover:bg-amber-100 border-none"
                          : "text-zinc-500"
                      )}
                    >
                      {buyer.match_status.replace("_", " ")}
                    </Badge>
                  </td>
                  <td style={styles.td}>
                    <span style={styles.odsTag}>{buyer.ods_code || "—"}</span>
                  </td>
                  <td style={styles.td}>
                    {buyer.entity_id ? (
                      <Link
                        href={`/entities/${buyer.entity_id}`}
                        style={styles.entityLink}
                      >
                        {buyer.entity_name}
                      </Link>
                    ) : (
                      <EntityLinker
                        entityName={buyer.buyer_name}
                        entityId={buyer.id}
                        entityKind="buyer"
                        buttonText="Link Entity"
                        buttonVariant="outline"
                        buttonSize="sm"
                        initialType="nhs_trust"
                      />
                    )}
                  </td>
                  <td style={styles.td}>
                    <span style={styles.typeTag}>{buyer.display_type}</span>
                  </td>
                  <td
                    style={{
                      ...styles.td,
                      textAlign: "right",
                      fontWeight: 600,
                    }}
                  >
                    {formatCurrency(parseFloat(buyer.total_spend))}
                  </td>
                  <td style={styles.td}>
                    {buyer.top_supplier_id ? (
                      <Link
                        href={`/suppliers/${buyer.top_supplier_id}`}
                        style={styles.supplierLink}
                      >
                        {buyer.top_supplier || "—"}
                      </Link>
                    ) : (
                      <span style={styles.supplierLink}>
                        {buyer.top_supplier || "—"}
                      </span>
                    )}
                  </td>
                  <td style={{ ...styles.td, textAlign: "center" }}>
                    {buyer.supplier_count}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <BuyerPagination
        currentPage={currentPage}
        totalPages={pagination.totalPages}
      />
    </div>
  );
}

function SummaryCard({
  value,
  label,
  href,
  highlight,
}: {
  value: string;
  label: string;
  href?: string;
  highlight?: boolean;
}) {
  const content = (
    <>
      <div style={styles.summaryValue}>{value}</div>
      <div style={styles.summaryLabel}>{label}</div>
      {href && <div style={styles.viewLink}>View All &rarr;</div>}
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        style={{
          ...styles.summaryCard,
          ...(highlight ? styles.summaryCardHighlight : {}),
          textDecoration: "none",
          display: "block",
        }}
      >
        {content}
      </Link>
    );
  }

  return (
    <div
      style={{
        ...styles.summaryCard,
        ...(highlight ? styles.summaryCardHighlight : {}),
      }}
    >
      {content}
    </div>
  );
}

const styles: { [key: string]: React.CSSProperties } = {
  container: {
    minHeight: "100vh",
    backgroundColor: "#fafafa",
    padding: "32px 48px",
    fontFamily:
      "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
  header: {
    marginBottom: "24px",
  },
  headerRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap" as const,
    gap: "16px",
  },
  title: {
    fontSize: "28px",
    fontWeight: 600,
    color: "#1a1a2e",
    margin: "0 0 16px 0",
  },
  sectionTitle: {
    fontSize: "16px",
    fontWeight: 600,
    color: "#555",
    margin: "0 0 16px 0",
  },
  summarySection: {
    marginBottom: "24px",
  },
  summaryGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
    gap: "16px",
  },
  summaryCard: {
    backgroundColor: "white",
    borderRadius: "12px",
    padding: "24px",
    border: "1px solid #e8e8e8",
    textAlign: "center" as const,
  },
  summaryCardHighlight: {
    backgroundColor: "#f8f5f0",
    borderColor: "#e8dfd0",
  },
  summaryValue: {
    fontSize: "36px",
    fontWeight: 600,
    color: "#1a1a2e",
    marginBottom: "4px",
  },
  summaryLabel: {
    fontSize: "13px",
    color: "#888",
  },
  viewLink: {
    fontSize: "12px",
    color: "#2563eb",
    marginTop: "12px",
    fontWeight: 500,
  },
  tableContainer: {
    backgroundColor: "white",
    borderRadius: "12px",
    border: "1px solid #e8e8e8",
    overflow: "hidden",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse" as const,
  },
  th: {
    textAlign: "left" as const,
    padding: "16px 20px",
    fontSize: "13px",
    fontWeight: 600,
    color: "#555",
    borderBottom: "1px solid #eee",
    backgroundColor: "#fafafa",
  },
  tr: {
    borderBottom: "1px solid #f0f0f0",
  },
  td: {
    padding: "16px 20px",
    fontSize: "14px",
    color: "#333",
  },
  buyerName: {
    fontWeight: 500,
    color: "#1a1a2e",
    textDecoration: "underline",
    cursor: "pointer",
  },
  entityLink: {
    color: "#2563eb",
    textDecoration: "underline",
    fontWeight: 500,
  },
  typeTag: {
    display: "inline-block",
    padding: "4px 10px",
    fontSize: "12px",
    backgroundColor: "#f0f0f0",
    borderRadius: "4px",
    color: "#666",
  },
  odsTag: {
    display: "inline-block",
    padding: "4px 8px",
    fontSize: "12px",
    backgroundColor: "#f3f4f6",
    borderRadius: "4px",
    color: "#4b5563",
    fontFamily: "monospace",
    fontWeight: 500,
  },
  supplierLink: {
    color: "#5c4d3c",
    textDecoration: "underline",
    cursor: "pointer",
  },
  emptyCell: {
    textAlign: "center" as const,
    padding: "48px",
    color: "#888",
  },
};
