import Link from "next/link";
import { getEntityData } from "@/lib/data/entities";
import { EntityFilters } from "./EntityFilters";
import { EntityPagination } from "./EntityPagination";
import { AISummarySection } from "./AISummarySection";

function formatCurrency(amount: number): string {
  if (amount >= 1_000_000_000) {
    return `£${(amount / 1_000_000_000).toFixed(2)}B`;
  }
  if (amount >= 1_000_000) {
    return `£${(amount / 1_000_000).toFixed(1)}M`;
  }
  if (amount >= 1_000) {
    return `£${(amount / 1_000).toFixed(0)}K`;
  }
  return `£${amount.toFixed(0)}`;
}

function formatNumber(num: number): string {
  return num.toLocaleString("en-GB");
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatMonth(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-GB", {
    month: "short",
    year: "numeric",
  });
}

function getDefaultDateRange() {
  const currentYear = new Date().getFullYear();
  const previousYear = currentYear - 1;
  return {
    startDate: `${previousYear}-01-01`,
    endDate: `${previousYear}-12-31`,
  };
}

export default async function EntityPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { id } = await params;
  const sParams = await searchParams;

  const entityId = parseInt(id);
  const defaultDates = getDefaultDateRange();

  const allTime = (sParams.allTime as string) === "1";
  const startDate = allTime
    ? ""
    : (sParams.startDate as string) || defaultDates.startDate;
  const endDate = allTime ? "" : (sParams.endDate as string) || defaultDates.endDate;
  const page = parseInt((sParams.page as string) || "1");
  const requestedView = sParams.view as "supplier" | "buyer" | undefined;

  const data = await getEntityData(entityId, {
    startDate,
    endDate,
    page,
    limit: 50,
    view: requestedView,
  });

  if (!data) {
    return (
      <div style={styles.container}>
        <div style={styles.error}>Entity not found</div>
        <Link href="/buyers" style={styles.backLink}>
          ← Back to Buyers
        </Link>
      </div>
    );
  }

  const {
    entity,
    activeView: view,
    linkedSuppliers,
    linkedBuyers,
    hasSupplierData,
    hasBuyerData,
    summary,
    topCounterparts,
    monthlySpend,
    topTransactions,
    transactions,
    pagination,
  } = data;

  const showTabs = linkedSuppliers.length > 0 && linkedBuyers.length > 0;

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <Link href="/buyers" style={styles.backLink}>
          ← Back to Buyers
        </Link>
        <h1 style={styles.title}>{entity.name}</h1>
        <div style={styles.meta}>
          <span style={styles.badgeEntityType}>
            {entity.entity_type.replace(/_/g, " ").toUpperCase()}
          </span>
          {entity.companyDetails && (
            <>
              <span style={styles.badge}>
                <a
                  href={`https://find-and-update.company-information.service.gov.uk/company/${entity.companyDetails.company_number}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={styles.companyLink}
                >
                  Companies House: {entity.companyDetails.company_number}
                </a>
              </span>
              <span
                style={{
                  ...styles.badgeStatus,
                  backgroundColor:
                    entity.companyDetails.company_status === "active"
                      ? "#dcfce7"
                      : "#fef3c7",
                  color:
                    entity.companyDetails.company_status === "active"
                      ? "#166534"
                      : "#92400e",
                }}
              >
                {entity.companyDetails.company_status}
              </span>
            </>
          )}
          {entity.councilDetails && (
            <>
              <span style={styles.badge}>
                GSS: {entity.councilDetails.gss_code}
              </span>
              <span style={styles.badge}>
                {entity.councilDetails.council_type}
              </span>
            </>
          )}
          {entity.nhsDetails && (
            <>
              <span style={styles.badge}>
                ODS: {entity.nhsDetails.ods_code}
              </span>
              <span style={styles.badge}>
                {entity.nhsDetails.org_sub_type || entity.nhsDetails.org_type}
              </span>
            </>
          )}
          {(entity.address_line_1 || entity.locality || entity.postal_code) && (
            <span style={styles.badge}>
              {[entity.address_line_1, entity.locality, entity.postal_code]
                .filter(Boolean)
                .join(", ")}
            </span>
          )}
        </div>
      </div>

      {/* View Switcher Tabs */}
      {showTabs && (
        <div style={styles.tabs}>
          <Link
            href={
              allTime
                ? `/entities/${entityId}?view=supplier&allTime=1`
                : `/entities/${entityId}?view=supplier&startDate=${startDate}&endDate=${endDate}`
            }
            style={{
              ...styles.tab,
              ...(view === "supplier" ? styles.activeTab : {}),
            }}
          >
            As Supplier
          </Link>
          <Link
            href={
              allTime
                ? `/entities/${entityId}?view=buyer&allTime=1`
                : `/entities/${entityId}?view=buyer&startDate=${startDate}&endDate=${endDate}`
            }
            style={{
              ...styles.tab,
              ...(view === "buyer" ? styles.activeTab : {}),
            }}
          >
            As Buyer
          </Link>
        </div>
      )}

      {/* Linked Identities */}
      <div style={{ ...styles.card, marginBottom: "24px" }}>
        <h2 style={{ ...styles.cardTitle, marginBottom: "12px" }}>
          {view === "supplier"
            ? `Consolidated Suppliers (${linkedSuppliers.length})`
            : `Consolidated Buyers (${linkedBuyers.length})`}
        </h2>
        <div style={styles.supplierTags}>
          {(view === "supplier" ? linkedSuppliers : linkedBuyers).map(
            (s: any) => (
              <Link
                key={s.id}
                href={view === "supplier" ? `/suppliers/${s.id}` : `/buyers/${s.id}`}
                style={styles.supplierTag}
              >
                {s.name}
              </Link>
            )
          )}
        </div>
      </div>

      {/* Filters */}
      <EntityFilters startDate={startDate} endDate={endDate} />

      {/* AI Summary Section */}
      <AISummarySection 
        entityId={entityId} 
        initialData={entity.ai_summary ? { summary: entity.ai_summary, news: entity.ai_news } : null} 
      />

      {/* Summary Cards */}
      {summary && (
        <div style={styles.summaryGrid}>
          <div
            style={{ ...styles.summaryCard, ...styles.summaryCardHighlight }}
          >
            <div style={styles.summaryValue}>
              {formatCurrency(summary.totalSpend)}
            </div>
            <div style={styles.summaryLabel}>
              Total {view === "supplier" ? "Consolidated" : "Buyer"} Spend
            </div>
          </div>
          <div style={styles.summaryCard}>
            <div style={styles.summaryValue}>
              {formatNumber(summary.transactionCount)}
            </div>
            <div style={styles.summaryLabel}>Transactions</div>
          </div>
          <div style={styles.summaryCard}>
            <div style={styles.summaryValue}>
              {formatNumber(
                view === "supplier" ? summary.buyerCount : summary.supplierCount
              )}
            </div>
            <div style={styles.summaryLabel}>
              {view === "supplier" ? "NHS Buyers" : "Suppliers"}
            </div>
          </div>
          <div style={styles.summaryCard}>
            <div style={styles.summaryValue}>
              {summary.earliestDate && summary.latestDate
                ? `${formatDate(summary.earliestDate).split(" ")[2]} - ${
                    formatDate(summary.latestDate).split(" ")[2]
                  }`
                : "—"}
            </div>
            <div style={styles.summaryLabel}>Date Range</div>
          </div>
        </div>
      )}

      {/* Three Column Layout */}
      <div style={styles.threeColumn}>
        {/* Top Counterparts */}
        <div style={styles.card}>
          <h2 style={{ ...styles.cardTitle, marginBottom: "16px" }}>
            {view === "supplier" ? "Top NHS Buyers" : "Top Suppliers"}
          </h2>
          <div style={styles.buyerList}>
            {topCounterparts.length === 0 ? (
              <div style={styles.emptyState}>No data found</div>
            ) : (
              topCounterparts.map((counterpart: any, index: number) => (
                <Link
                  key={counterpart.id}
                  href={
                    view === "supplier"
                      ? `/buyers/${counterpart.id}`
                      : `/suppliers/${counterpart.id}`
                  }
                  style={{ textDecoration: "none" }}
                >
                  <div style={styles.buyerRow}>
                    <div style={styles.buyerRank}>{index + 1}</div>
                    <div style={styles.buyerInfo}>
                      <div style={styles.buyerName}>{counterpart.name}</div>
                      <div style={styles.buyerMeta}>
                        {formatNumber(counterpart.transactionCount)} transactions
                      </div>
                    </div>
                    <div style={styles.buyerSpend}>
                      {formatCurrency(counterpart.totalSpend)}
                    </div>
                  </div>
                </Link>
              ))
            )}
          </div>
        </div>

        {/* Top Transactions */}
        <div style={styles.card}>
          <h2 style={{ ...styles.cardTitle, marginBottom: "16px" }}>
            Top 10 Transactions
          </h2>
          <div style={styles.topTxList}>
            {topTransactions.length === 0 ? (
              <div style={styles.emptyState}>No transaction data</div>
            ) : (
              topTransactions.map((tx: any, index: number) => (
                <div key={tx.id} style={styles.topTxRow}>
                  <div style={styles.topTxRank}>{index + 1}</div>
                  <div style={styles.topTxInfo}>
                    <Link
                      href={
                        view === "supplier"
                          ? `/buyers/${tx.buyer_id}`
                          : `/suppliers/${tx.supplier_id}`
                      }
                      style={styles.topTxBuyer}
                    >
                      {view === "supplier" ? tx.buyer : tx.supplier_name}
                    </Link>
                    <div style={styles.topTxDate}>
                      {formatDate(tx.payment_date)}
                    </div>
                    <div style={styles.topTxSupplier}>
                      {view === "supplier"
                        ? `by ${tx.buyer}`
                        : `to ${tx.supplier_name}`}
                    </div>
                  </div>
                  <div style={styles.topTxAmount}>
                    £
                    {parseFloat(tx.amount).toLocaleString("en-GB", {
                      minimumFractionDigits: 0,
                    })}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Monthly Spend */}
        <div style={styles.card}>
          <h2 style={{ ...styles.cardTitle, marginBottom: "16px" }}>
            Monthly {view === "supplier" ? "Payments" : "Spending"}
          </h2>
          <div style={styles.monthlyList}>
            {monthlySpend.length === 0 ? (
              <div style={styles.emptyState}>No monthly data</div>
            ) : (
              monthlySpend.slice(0, 12).map((month: any) => (
                <div key={month.month} style={styles.monthRow}>
                  <div style={styles.monthName}>{formatMonth(month.month)}</div>
                  <div style={styles.monthBar}>
                    <div
                      style={{
                        ...styles.monthBarFill,
                        width: `${Math.min(
                          100,
                          (month.totalSpend /
                            Math.max(
                              ...monthlySpend.map((m: any) => m.totalSpend)
                            )) *
                            100
                        )}%`,
                      }}
                    />
                  </div>
                  <div style={styles.monthSpend}>
                    {formatCurrency(month.totalSpend)}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Transactions Table */}
      <div style={styles.card}>
        <h2 style={{ ...styles.cardTitle, marginBottom: "16px" }}>
          Consolidated Transactions
        </h2>
        <div style={styles.tableContainer}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Date</th>
                {view === "supplier" ? (
                  <>
                    <th style={styles.th}>Buyer</th>
                    <th style={styles.th}>Linked Buyer</th>
                    <th style={styles.th}>Supplier (Source)</th>
                  </>
                ) : (
                  <>
                    <th style={styles.th}>Supplier</th>
                    <th style={styles.th}>Linked Entity</th>
                    <th style={styles.th}>Buyer (Source)</th>
                  </>
                )}
                <th style={styles.th}>Source File</th>
                <th style={{ ...styles.th, textAlign: "right" }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {transactions.length === 0 ? (
                <tr>
                  <td colSpan={6} style={styles.emptyCell}>
                    No transactions found
                  </td>
                </tr>
              ) : (
                transactions.map((tx: any) => (
                  <tr key={tx.id} style={styles.tr}>
                    <td style={styles.td}>{formatDate(tx.payment_date)}</td>
                    {view === "supplier" ? (
                      <>
                        <td style={styles.td}>
                          <Link
                            href={`/buyers/${tx.buyer_id}`}
                            style={styles.buyerLink}
                          >
                            {tx.buyer}
                          </Link>
                        </td>
                        <td style={styles.td}>
                          {tx.buyer_entity_id ? (
                            <Link
                              href={`/entities/${tx.buyer_entity_id}`}
                              style={styles.buyerLink}
                            >
                              {tx.buyer_entity_name}
                            </Link>
                          ) : (
                            <span style={styles.sourceSupplier}>—</span>
                          )}
                        </td>
                        <td style={styles.td}>
                          <Link
                            href={`/suppliers/${tx.supplier_id}`}
                            style={styles.sourceSupplier}
                          >
                            {tx.supplier_name}
                          </Link>
                        </td>
                      </>
                    ) : (
                      <>
                        <td style={styles.td}>
                          <Link
                            href={`/suppliers/${tx.supplier_id}`}
                            style={styles.buyerLink}
                          >
                            {tx.supplier_name}
                          </Link>
                        </td>
                        <td style={styles.td}>
                          {tx.supplier_entity_id ? (
                            <Link
                              href={`/entities/${tx.supplier_entity_id}`}
                              style={styles.buyerLink}
                            >
                              {tx.supplier_entity_name}
                            </Link>
                          ) : (
                            <span style={styles.sourceSupplier}>—</span>
                          )}
                        </td>
                        <td style={styles.td}>
                          <Link
                            href={`/buyers/${tx.buyer_id}`}
                            style={styles.sourceSupplier}
                          >
                            {tx.buyer}
                          </Link>
                        </td>
                      </>
                    )}
                    <td style={styles.td}>
                      <div style={styles.sourceFileInfo}>
                        {tx.run_id ? (
                          <Link
                            href={`/pipeline/runs/${tx.run_id}`}
                            style={styles.sourceFileLink}
                            title="View pipeline run details"
                          >
                            {tx.original_name}
                          </Link>
                        ) : (
                          <span style={styles.sourceFileText}>
                            {tx.original_name}
                          </span>
                        )}
                        <span style={styles.sourceRow}>
                          Row {tx.source_row_number}
                          {tx.source_sheet !== "Sheet1" &&
                            ` (${tx.source_sheet})`}
                        </span>
                      </div>
                    </td>
                    <td
                      style={{
                        ...styles.td,
                        textAlign: "right",
                        fontWeight: 600,
                      }}
                    >
                      £
                      {parseFloat(tx.amount).toLocaleString("en-GB", {
                        minimumFractionDigits: 2,
                      })}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {pagination && pagination.totalPages > 1 && (
          <EntityPagination
            page={page}
            totalPages={pagination.totalPages}
            total={pagination.total}
          />
        )}
      </div>
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
  backLink: {
    display: "inline-block",
    color: "#5c4d3c",
    textDecoration: "none",
    fontSize: "14px",
    marginBottom: "12px",
  },
  title: {
    fontSize: "28px",
    fontWeight: 600,
    color: "#2D213F",
    margin: "0 0 12px 0",
  },
  meta: {
    display: "flex",
    gap: "8px",
    flexWrap: "wrap" as const,
  },
  badge: {
    display: "inline-block",
    padding: "4px 10px",
    fontSize: "12px",
    fontFamily: "monospace",
    backgroundColor: "#f0f0f0",
    borderRadius: "4px",
    color: "#666",
  },
  badgeEntityType: {
    display: "inline-block",
    padding: "4px 10px",
    fontSize: "11px",
    fontWeight: 700,
    backgroundColor: "#2D213F",
    color: "white",
    borderRadius: "4px",
  },
  badgeStatus: {
    display: "inline-block",
    padding: "4px 10px",
    fontSize: "12px",
    borderRadius: "4px",
    textTransform: "capitalize" as const,
  },
  companyLink: {
    color: "#5c4d3c",
    textDecoration: "none",
  },
  tabs: {
    display: "flex",
    gap: "4px",
    marginBottom: "24px",
    borderBottom: "1px solid #e8e8e8",
    paddingBottom: "1px",
  },
  tab: {
    padding: "10px 20px",
    fontSize: "14px",
    fontWeight: 500,
    color: "#666",
    textDecoration: "none",
    borderBottom: "2px solid transparent",
    transition: "all 0.2s",
  },
  activeTab: {
    color: "#2D213F",
    borderBottomColor: "#2D213F",
  },
  supplierTags: {
    display: "flex",
    flexWrap: "wrap",
    gap: "8px",
  },
  supplierTag: {
    padding: "6px 12px",
    backgroundColor: "#f1f5f9",
    color: "#475569",
    borderRadius: "20px",
    fontSize: "13px",
    textDecoration: "none",
    border: "1px solid #e2e8f0",
    transition: "all 0.2s",
  },
  summaryGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
    gap: "16px",
    marginBottom: "24px",
  },
  summaryCard: {
    backgroundColor: "white",
    borderRadius: "12px",
    padding: "24px",
    border: "1px solid #e8e8e8",
    textAlign: "center" as const,
  },
  summaryCardHighlight: {
    backgroundColor: "#f0f8f0",
    borderColor: "#d0e8d0",
  },
  summaryValue: {
    fontSize: "28px",
    fontWeight: 600,
    color: "#2D213F",
    marginBottom: "4px",
  },
  summaryLabel: {
    fontSize: "13px",
    color: "#888",
  },
  threeColumn: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr 1fr",
    gap: "24px",
    marginBottom: "24px",
  },
  card: {
    backgroundColor: "white",
    borderRadius: "12px",
    border: "1px solid #e8e8e8",
    padding: "24px",
  },
  cardTitle: {
    fontSize: "16px",
    fontWeight: 600,
    color: "#2D213F",
    margin: 0,
  },
  buyerList: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "8px",
  },
  buyerRow: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    padding: "8px",
    borderRadius: "6px",
    cursor: "pointer",
    transition: "background-color 0.15s ease",
    borderBottom: "1px solid #f0f0f0",
  },
  buyerRank: {
    width: "24px",
    height: "24px",
    borderRadius: "50%",
    backgroundColor: "#f0f0f0",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "12px",
    fontWeight: 600,
    color: "#666",
  },
  buyerInfo: {
    flex: 1,
    minWidth: 0,
  },
  buyerName: {
    fontSize: "14px",
    fontWeight: 500,
    color: "#2D213F",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  },
  buyerMeta: {
    fontSize: "12px",
    color: "#888",
  },
  buyerSpend: {
    fontSize: "14px",
    fontWeight: 600,
    color: "#2D213F",
  },
  topTxList: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "8px",
  },
  topTxRow: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    padding: "8px 0",
    borderBottom: "1px solid #f0f0f0",
  },
  topTxRank: {
    width: "24px",
    height: "24px",
    borderRadius: "50%",
    backgroundColor: "#dcfce7",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "12px",
    fontWeight: 600,
    color: "#166534",
  },
  topTxInfo: {
    flex: 1,
    minWidth: 0,
  },
  topTxBuyer: {
    fontSize: "13px",
    fontWeight: 500,
    color: "#5c4d3c",
    textDecoration: "none",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
    display: "block",
  },
  topTxDate: {
    fontSize: "11px",
    color: "#888",
  },
  topTxSupplier: {
    fontSize: "10px",
    color: "#aaa",
    fontStyle: "italic",
  },
  topTxAmount: {
    fontSize: "14px",
    fontWeight: 600,
    color: "#2D213F",
  },
  monthlyList: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "8px",
  },
  monthRow: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
  },
  monthName: {
    width: "70px",
    fontSize: "13px",
    color: "#666",
  },
  monthBar: {
    flex: 1,
    height: "8px",
    backgroundColor: "#f0f0f0",
    borderRadius: "4px",
    overflow: "hidden",
  },
  monthBarFill: {
    height: "100%",
    backgroundColor: "#22c55e",
    borderRadius: "4px",
  },
  monthSpend: {
    width: "80px",
    textAlign: "right" as const,
    fontSize: "13px",
    fontWeight: 500,
    color: "#2D213F",
  },
  tableContainer: {
    overflow: "auto",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse" as const,
  },
  th: {
    textAlign: "left" as const,
    padding: "12px 16px",
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
    padding: "12px 16px",
    fontSize: "14px",
    color: "#333",
  },
  emptyCell: {
    textAlign: "center" as const,
    padding: "48px",
    color: "#888",
  },
  emptyState: {
    textAlign: "center" as const,
    padding: "24px",
    color: "#888",
    fontSize: "14px",
  },
  error: {
    backgroundColor: "#fef2f2",
    color: "#dc2626",
    padding: "16px 20px",
    borderRadius: "8px",
    marginBottom: "16px",
    fontSize: "14px",
  },
  buyerLink: {
    color: "#5c4d3c",
    textDecoration: "none",
  },
  sourceSupplier: {
    fontSize: "12px",
    color: "#666",
    fontStyle: "italic",
  },
  sourceFileInfo: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
  },
  sourceFileLink: {
    fontSize: "12px",
    color: "#2563eb",
    textDecoration: "none",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    maxWidth: "200px",
    display: "block",
  },
  sourceFileText: {
    fontSize: "12px",
    color: "#666",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    maxWidth: "200px",
    display: "block",
  },
  sourceRow: {
    fontSize: "11px",
    color: "#999",
  },
};
