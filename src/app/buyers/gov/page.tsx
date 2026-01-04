import { getBuyersData } from "@/lib/data/buyers";
import { EntityLinker } from "@/components/EntityLinker";
import Link from "next/link";
import { BuyerSearch } from "../BuyerSearch";
import { BuyerDateRange } from "../BuyerDateRange";
import { getDefaultDateRange } from "@/lib/utils";
import { BuyerPagination } from "../BuyerPagination";

interface Buyer {
  id: number;
  buyer_name: string;
  entity_name: string | null;
  entity_id: number | null;
  trust_type: string | null;
  ods_code: string | null;
  total_spend: string;
  supplier_count: number;
  top_supplier: string | null;
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

export default async function GovBuyersPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sParams = await searchParams;
  const currentPage = parseInt((sParams.page as string) || "1", 10);
  const search = (sParams.search as string) || "";

  const defaultDates = getDefaultDateRange();
  const startDate = (sParams.startDate as string) || defaultDates.startDate;
  const endDate = (sParams.endDate as string) || defaultDates.endDate;

  const { buyers, summary, pagination } = await getBuyersData({
    page: currentPage,
    limit: 20,
    orgType: "gov",
    search,
    startDate,
    endDate,
  });

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.breadcrumb}>
          <Link href="/buyers" style={styles.breadcrumbLink}>Buyers</Link>
          <span style={styles.breadcrumbSeparator}>/</span>
          <span style={styles.breadcrumbCurrent}>Government Departments</span>
        </div>
        <h1 style={styles.title}>Government Department Spend</h1>
        <div style={styles.headerRow}>
          <BuyerDateRange />
        </div>
      </div>

      {/* Summary Cards */}
      <div style={styles.summarySection}>
        <div style={styles.summaryGrid}>
          <SummaryCard
            value={formatCurrency(summary.totalSpend)}
            label="Total Spend"
          />
          <SummaryCard
            value={formatNumber(summary.totalBuyers)}
            label="Departments"
          />
        </div>
      </div>

      {/* Search */}
      <BuyerSearch />

      {/* Data Table */}
      <div style={styles.tableContainer}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Department Name</th>
              <th style={styles.th}>Linked Entity</th>
              <th style={{ ...styles.th, textAlign: "right" }}>Total Spend</th>
              <th style={styles.th}>Top Supplier</th>
              <th style={{ ...styles.th, textAlign: "center" }}># of Suppliers</th>
            </tr>
          </thead>
          <tbody>
            {buyers.length === 0 ? (
              <tr>
                <td colSpan={5} style={styles.emptyCell}>
                  No government departments found
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
                        initialType="government_department"
                      />
                    )}
                  </td>
                  <td style={{ ...styles.td, textAlign: "right", fontWeight: 600 }}>
                    {formatCurrency(parseFloat(buyer.total_spend))}
                  </td>
                  <td style={styles.td}>
                    <span style={styles.supplierLink}>
                      {buyer.top_supplier || "—"}
                    </span>
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
      <BuyerPagination currentPage={currentPage} totalPages={pagination.totalPages} />
    </div>
  );
}

function SummaryCard({
  value,
  label,
}: {
  value: string;
  label: string;
}) {
  return (
    <div style={styles.summaryCard}>
      <div style={styles.summaryValue}>{value}</div>
      <div style={styles.summaryLabel}>{label}</div>
    </div>
  );
}

const styles: { [key: string]: React.CSSProperties } = {
  container: {
    minHeight: "100vh",
    backgroundColor: "#fafafa",
    padding: "32px 48px",
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
  header: {
    marginBottom: "24px",
  },
  breadcrumb: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    marginBottom: "12px",
    fontSize: "14px",
  },
  breadcrumbLink: {
    color: "#666",
    textDecoration: "none",
  },
  breadcrumbSeparator: {
    color: "#ccc",
  },
  breadcrumbCurrent: {
    color: "#1a1a2e",
    fontWeight: 500,
  },
  headerRow: {
    display: "flex",
    justifyContent: "flex-end",
    alignItems: "center",
    marginBottom: "16px",
  },
  title: {
    fontSize: "28px",
    fontWeight: 600,
    color: "#1a1a2e",
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

