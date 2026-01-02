import { getBuyersData } from "@/lib/data/buyers";
import RegionalActivity from "../RegionalActivity";
import { EntityLinker } from "@/components/EntityLinker";
import Link from "next/link";
import { BuyerSearch } from "../BuyerSearch";
import { BuyerDateRange } from "../BuyerDateRange";
import { getDefaultDateRange } from "@/lib/utils";
import { BuyerTabs } from "../BuyerTabs";
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

interface Summary {
  totalBuyers: number;
  activeLast90Days: number;
  totalSpend: number;
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

export default async function NHSBuyersPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sParams = await searchParams;
  const currentPage = parseInt((sParams.page as string) || "1", 10);
  const search = (sParams.search as string) || "";
  const tabParam = (sParams.tab as string) || "listings";
  const activeTab = tabParam === "regional" ? "regional" : "listings";
  const regionParam = (sParams.region as string) || null;

  const defaultDates = getDefaultDateRange();
  const startDate = (sParams.startDate as string) || defaultDates.startDate;
  const endDate = (sParams.endDate as string) || defaultDates.endDate;

  const { buyers, parentOrganisations, summary, pagination } = await getBuyersData({
    page: currentPage,
    limit: 20,
    orgType: "nhs",
    search,
    startDate,
    endDate,
  });

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <h1 style={styles.title}>NHS Spend Data - Buyers</h1>
        <div style={styles.headerRow}>
          <BuyerTabs />
          <BuyerDateRange />
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === "regional" ? (
        <RegionalActivity 
          startDate={startDate} 
          endDate={endDate} 
          initialRegion={regionParam}
          orgType="nhs"
        />
      ) : (
        <>
          {/* Parent Organisations - National/Regional Bodies */}
          {parentOrganisations.length > 0 && (
            <div style={styles.parentOrgsSection}>
              <h2 style={styles.sectionTitle}>National NHS Bodies</h2>
              <div style={styles.parentOrgsGrid}>
                {parentOrganisations.map((org: any) => (
                  <div key={org.id} style={styles.parentOrgCard}>
                    <div style={styles.parentOrgName}>{org.name}</div>
                    <div style={styles.parentOrgSpend}>
                      {formatCurrency(parseFloat(org.total_spend))}
                    </div>
                    <div style={styles.parentOrgMeta}>
                      {formatNumber(org.supplier_count)} suppliers
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Summary Cards */}
          <div style={styles.summarySection}>
            <h2 style={styles.sectionTitle}>NHS Sub-Organisations Overview</h2>
            <div style={styles.summaryGrid}>
              <SummaryCard
                value={formatNumber(summary.totalBuyers)}
                label="Total NHS organisations"
              />
              <SummaryCard
                value={formatNumber(summary.activeLast90Days)}
                label="Active last 90 days"
              />
              <SummaryCard
                value={formatCurrency(summary.totalSpend)}
                label="Total spend recorded"
                highlight
              />
              <SummaryCard
                value={formatNumber(pagination.total)}
                label="Organisations with data"
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
                  <th style={styles.th}>NHS Buyer</th>
                  <th style={styles.th}>ODS Code</th>
                  <th style={styles.th}>Linked Entity</th>
                  <th style={styles.th}>Type</th>
                  <th style={{ ...styles.th, textAlign: "right" }}>Total Spend</th>
                  <th style={styles.th}>Top Supplier</th>
                  <th style={{ ...styles.th, textAlign: "center" }}># of Suppliers</th>
                </tr>
              </thead>
              <tbody>
                {buyers.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={styles.emptyCell}>
                      No NHS buyers found
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
                        <span style={styles.odsTag}>
                          {buyer.ods_code || "—"}
                        </span>
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
                        <span style={styles.typeTag}>
                          {buyer.trust_type || "NHS"}
                        </span>
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
        </>
      )}
    </div>
  );
}

function SummaryCard({
  value,
  label,
  highlight,
}: {
  value: string;
  label: string;
  highlight?: boolean;
}) {
  return (
    <div
      style={{
        ...styles.summaryCard,
        ...(highlight ? styles.summaryCardHighlight : {}),
      }}
    >
      <div style={styles.summaryValue}>
        {value}
      </div>
      <div style={styles.summaryLabel}>{label}</div>
      <button style={styles.viewLink}>View</button>
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
  parentOrgsSection: {
    marginBottom: "32px",
  },
  parentOrgsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
    gap: "16px",
  },
  parentOrgCard: {
    backgroundColor: "#1a1a2e",
    borderRadius: "12px",
    padding: "24px",
    color: "white",
  },
  parentOrgName: {
    fontSize: "15px",
    fontWeight: 500,
    marginBottom: "8px",
    opacity: 0.9,
  },
  parentOrgSpend: {
    fontSize: "32px",
    fontWeight: 700,
    marginBottom: "4px",
  },
  parentOrgMeta: {
    fontSize: "13px",
    opacity: 0.7,
  },
  summarySection: {
    marginBottom: "24px",
  },
  summaryGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
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
    marginBottom: "12px",
  },
  viewLink: {
    fontSize: "13px",
    color: "#5c4d3c",
    textDecoration: "underline",
    background: "none",
    border: "none",
    cursor: "pointer",
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
