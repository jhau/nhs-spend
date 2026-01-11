"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

interface Organisation {
  id: number;
  name: string;
  entityName: string | null;
  entityType: string | null;
  registryId: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  locality: string | null;
  postCode: string | null;
  country: string | null;
  entityStatus: string | null;
  displayType: string | null;
  odsCode: string | null;
  icbOdsCode: string | null;
  latitude: number | null;
  longitude: number | null;
  matchStatus: string;
  matchConfidence: string | null;
}

interface Summary {
  totalSpend: number;
  transactionCount: number;
  supplierCount: number;
  earliestDate: string | null;
  latestDate: string | null;
}

interface Supplier {
  id: number;
  name: string;
  totalSpend: number;
  transactionCount: number;
}

interface MonthlySpend {
  month: string;
  totalSpend: number;
  transactionCount: number;
}

interface Transaction {
  id: number;
  supplier: string;
  amount: string;
  payment_date: string;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

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

export default function OrganisationPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const id = params.id as string;

  const [organisation, setOrganisation] = useState<Organisation | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [topSuppliers, setTopSuppliers] = useState<Supplier[]>([]);
  const [monthlySpend, setMonthlySpend] = useState<MonthlySpend[]>([]);
  const [topTransactions, setTopTransactions] = useState<Transaction[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);

  // Date range
  const defaultDates = getDefaultDateRange();
  const [startDate, setStartDate] = useState(
    searchParams.get("startDate") || defaultDates.startDate
  );
  const [endDate, setEndDate] = useState(
    searchParams.get("endDate") || defaultDates.endDate
  );

  // Supplier exclusion filter
  const [excludeSuppliers, setExcludeSuppliers] = useState("");
  const [excludeInput, setExcludeInput] = useState("");

  // Selected supplier filter (for clicking on top suppliers)
  const [selectedSupplier, setSelectedSupplier] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: currentPage.toString(),
        limit: "50",
        ...(startDate && { startDate }),
        ...(endDate && { endDate }),
        ...(excludeSuppliers && { excludeSuppliers }),
        ...(selectedSupplier && { supplier: selectedSupplier }),
      });
      const res = await fetch(`/api/buyers/${id}?${params}`);
      if (!res.ok) {
        if (res.status === 404) {
          setError("Organisation not found");
        } else {
          throw new Error("Failed to fetch data");
        }
        return;
      }
      const data = await res.json();
      setOrganisation(data.buyer);
      setSummary(data.summary);
      setTopSuppliers(data.topSuppliers);
      setMonthlySpend(data.monthlySpend);
      setTopTransactions(data.topTransactions);
      setTransactions(data.transactions);
      setPagination(data.pagination);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [id, currentPage, startDate, endDate, excludeSuppliers, selectedSupplier]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const setDatePreset = (preset: string) => {
    switch (preset) {
      case "2024":
        setStartDate("2024-01-01");
        setEndDate("2024-12-31");
        break;
      case "2023":
        setStartDate("2023-01-01");
        setEndDate("2023-12-31");
        break;
      case "2022":
        setStartDate("2022-01-01");
        setEndDate("2022-12-31");
        break;
      case "all":
        setStartDate("");
        setEndDate("");
        break;
    }
    setCurrentPage(1);
  };

  if (loading && !organisation) {
    return (
      <div style={styles.container}>
        <div style={styles.loading}>Loading...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={styles.container}>
        <div style={styles.error}>{error}</div>
        <Link href="/buyers" style={styles.backLink}>
          ← Back to Buyers
        </Link>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <Link href="/buyers" style={styles.backLink}>
          ← Back to Buyers
        </Link>
        <div style={styles.headerTop}>
          <div style={styles.titleSection}>
            <h1 style={styles.title}>{organisation?.name}</h1>
            <div style={styles.verificationBadge}>
              {organisation?.matchStatus === "matched" ? (
                <span style={styles.verifiedBadge}>Verified</span>
              ) : (
                <span style={styles.unverifiedBadge}>Unverified</span>
              )}
            </div>
          </div>
          <div style={styles.meta}>
            {organisation?.odsCode && (
              <span style={styles.badge}>ODS: {organisation.odsCode}</span>
            )}
            {organisation?.icbOdsCode && (
              <span style={styles.badge}>ICB: {organisation.icbOdsCode}</span>
            )}
            {organisation?.displayType && (
              <span style={styles.badgeType}>{organisation.displayType}</span>
            )}
          </div>
        </div>

        {/* Entity Details (if verified) */}
        {organisation?.matchStatus === "matched" && (
          <div style={styles.entityDetailsCard}>
            <h2 style={styles.entityDetailsTitle}>Entity Details</h2>
            <div style={styles.entityDetailsGrid}>
              <div style={styles.entityDetailItem}>
                <span style={styles.detailLabel}>Official Name:</span>
                <span style={styles.detailValue}>{organisation.entityName}</span>
              </div>
              <div style={styles.entityDetailItem}>
                <span style={styles.detailLabel}>Registry ID:</span>
                <span style={styles.detailValue}>{organisation.registryId}</span>
              </div>
              <div style={styles.entityDetailItem}>
                <span style={styles.detailLabel}>Type:</span>
                <span style={styles.detailValue}>{organisation.entityType}</span>
              </div>
              <div style={styles.entityDetailItem}>
                <span style={styles.detailLabel}>Status:</span>
                <span style={styles.detailValue}>{organisation.entityStatus}</span>
              </div>
              {(organisation.addressLine1 || organisation.locality || organisation.postCode) && (
                <div style={{ ...styles.entityDetailItem, gridColumn: "span 2" }}>
                  <span style={styles.detailLabel}>Address:</span>
                  <span style={styles.detailValue}>
                    {[
                      organisation.addressLine1,
                      organisation.addressLine2,
                      organisation.locality,
                      organisation.postCode,
                      organisation.country,
                    ]
                      .filter(Boolean)
                      .join(", ")}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Filters */}
      <div style={styles.filtersContainer}>
        <div style={styles.dateRangeContainer}>
          <div style={styles.datePresets}>
            <button
              style={{
                ...styles.presetButton,
                ...(startDate === "2024-01-01" && endDate === "2024-12-31"
                  ? styles.presetButtonActive
                  : {}),
              }}
              onClick={() => setDatePreset("2024")}
            >
              2024
            </button>
            <button
              style={{
                ...styles.presetButton,
                ...(startDate === "2023-01-01" && endDate === "2023-12-31"
                  ? styles.presetButtonActive
                  : {}),
              }}
              onClick={() => setDatePreset("2023")}
            >
              2023
            </button>
            <button
              style={{
                ...styles.presetButton,
                ...(startDate === "2022-01-01" && endDate === "2022-12-31"
                  ? styles.presetButtonActive
                  : {}),
              }}
              onClick={() => setDatePreset("2022")}
            >
              2022
            </button>
            <button
              style={{
                ...styles.presetButton,
                ...(!startDate && !endDate ? styles.presetButtonActive : {}),
              }}
              onClick={() => setDatePreset("all")}
            >
              All Time
            </button>
          </div>
          <div style={styles.dateInputs}>
            <input
              type="date"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                setCurrentPage(1);
              }}
              style={styles.dateInput}
            />
            <span style={styles.dateSeparator}>to</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => {
                setEndDate(e.target.value);
                setCurrentPage(1);
              }}
              style={styles.dateInput}
            />
          </div>
        </div>

        {/* Supplier Exclusion Filter */}
        <div style={styles.excludeContainer}>
          <span style={styles.filterLabel}>Exclude suppliers:</span>
          <input
            type="text"
            value={excludeInput}
            onChange={(e) => setExcludeInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                setExcludeSuppliers(excludeInput);
                setCurrentPage(1);
              }
            }}
            placeholder="e.g. hmrc, nhs property"
            style={styles.excludeInput}
          />
          <button
            onClick={() => {
              setExcludeSuppliers(excludeInput);
              setCurrentPage(1);
            }}
            style={styles.filterButton}
          >
            Apply
          </button>
          {excludeSuppliers && (
            <button
              onClick={() => {
                setExcludeInput("");
                setExcludeSuppliers("");
                setCurrentPage(1);
              }}
              style={styles.clearButton}
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div style={styles.summaryGrid}>
          <div style={{ ...styles.summaryCard, ...styles.summaryCardHighlight }}>
            <div style={styles.summaryValue}>
              {formatCurrency(summary.totalSpend)}
            </div>
            <div style={styles.summaryLabel}>Total Spend</div>
          </div>
          <div style={styles.summaryCard}>
            <div style={styles.summaryValue}>
              {formatNumber(summary.transactionCount)}
            </div>
            <div style={styles.summaryLabel}>Transactions</div>
          </div>
          <div style={styles.summaryCard}>
            <div style={styles.summaryValue}>
              {formatNumber(summary.supplierCount)}
            </div>
            <div style={styles.summaryLabel}>Suppliers</div>
          </div>
          <div style={styles.summaryCard}>
            <div style={styles.summaryValue}>
              {summary.earliestDate && summary.latestDate
                ? `${formatDate(summary.earliestDate).split(" ")[2]} - ${formatDate(summary.latestDate).split(" ")[2]}`
                : "—"}
            </div>
            <div style={styles.summaryLabel}>Date Range</div>
          </div>
        </div>
      )}

      {/* Three Column Layout */}
      <div style={styles.threeColumn}>
        {/* Top Suppliers */}
        <div style={styles.card}>
          <div style={styles.cardTitleRow}>
            <h2 style={styles.cardTitle}>Top Suppliers</h2>
            {selectedSupplier && (
              <button
                onClick={() => {
                  setSelectedSupplier(null);
                  setCurrentPage(1);
                }}
                style={styles.clearFilterButton}
              >
                Clear filter
              </button>
            )}
          </div>
          <div style={styles.supplierList}>
            {topSuppliers.length === 0 ? (
              <div style={styles.emptyState}>No supplier data</div>
            ) : (
              topSuppliers.map((supplier, index) => (
                <div
                  key={supplier.name}
                  style={{
                    ...styles.supplierRow,
                    ...styles.supplierRowClickable,
                    ...(selectedSupplier === supplier.name ? styles.supplierRowSelected : {}),
                  }}
                >
                  <div style={styles.supplierRank}>{index + 1}</div>
                  <div
                    style={styles.supplierInfo}
                    onClick={() => {
                      setSelectedSupplier(selectedSupplier === supplier.name ? null : supplier.name);
                      setCurrentPage(1);
                    }}
                  >
                    <div style={styles.supplierName}>{supplier.name}</div>
                    <div style={styles.supplierMeta}>
                      {formatNumber(supplier.transactionCount)} transactions
                    </div>
                  </div>
                  <div style={styles.supplierActions}>
                    <div style={styles.supplierSpend}>
                      {formatCurrency(supplier.totalSpend)}
                    </div>
                    <Link
                      href={`/suppliers/${supplier.id}`}
                      style={styles.supplierLink}
                      title="View supplier page"
                    >
                      →
                    </Link>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Top Transactions */}
        <div style={styles.card}>
          <h2 style={{ ...styles.cardTitle, marginBottom: "16px" }}>Top 10 Transactions</h2>
          <div style={styles.topTxList}>
            {topTransactions.length === 0 ? (
              <div style={styles.emptyState}>No transaction data</div>
            ) : (
              topTransactions.map((tx, index) => (
                <div key={tx.id} style={styles.topTxRow}>
                  <div style={styles.topTxRank}>{index + 1}</div>
                  <div style={styles.topTxInfo}>
                    <div style={styles.topTxSupplier}>{tx.supplier}</div>
                    <div style={styles.topTxDate}>{formatDate(tx.payment_date)}</div>
                  </div>
                  <div style={styles.topTxAmount}>
                    £{parseFloat(tx.amount).toLocaleString("en-GB", { minimumFractionDigits: 0 })}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Monthly Spend */}
        <div style={styles.card}>
          <h2 style={{ ...styles.cardTitle, marginBottom: "16px" }}>Monthly Spend</h2>
          <div style={styles.monthlyList}>
            {monthlySpend.length === 0 ? (
              <div style={styles.emptyState}>No monthly data</div>
            ) : (
              monthlySpend.slice(0, 12).map((month) => (
                <div key={month.month} style={styles.monthRow}>
                  <div style={styles.monthName}>{formatMonth(month.month)}</div>
                  <div style={styles.monthBar}>
                    <div
                      style={{
                        ...styles.monthBarFill,
                        width: `${Math.min(100, (month.totalSpend / Math.max(...monthlySpend.map((m) => m.totalSpend))) * 100)}%`,
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
          {selectedSupplier ? `Transactions with ${selectedSupplier}` : "Recent Transactions"}
        </h2>
        <div style={styles.tableContainer}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Date</th>
                <th style={styles.th}>Supplier</th>
                <th style={{ ...styles.th, textAlign: "right" }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={3} style={styles.loadingCell}>
                    Loading...
                  </td>
                </tr>
              ) : transactions.length === 0 ? (
                <tr>
                  <td colSpan={3} style={styles.emptyCell}>
                    No transactions found
                  </td>
                </tr>
              ) : (
                transactions.map((tx) => (
                  <tr key={tx.id} style={styles.tr}>
                    <td style={styles.td}>{formatDate(tx.payment_date)}</td>
                    <td style={styles.td}>{tx.supplier}</td>
                    <td style={{ ...styles.td, textAlign: "right", fontWeight: 600 }}>
                      £{parseFloat(tx.amount).toLocaleString("en-GB", { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {pagination && pagination.totalPages > 1 && (
          <div style={styles.pagination}>
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              style={{
                ...styles.pageButton,
                opacity: currentPage === 1 ? 0.5 : 1,
              }}
            >
              Previous
            </button>
            <span style={styles.pageInfo}>
              Page {pagination.page} of {pagination.totalPages} ({formatNumber(pagination.total)} transactions)
            </span>
            <button
              onClick={() => setCurrentPage((p) => Math.min(pagination.totalPages, p + 1))}
              disabled={currentPage === pagination.totalPages}
              style={{
                ...styles.pageButton,
                opacity: currentPage === pagination.totalPages ? 0.5 : 1,
              }}
            >
              Next
            </button>
          </div>
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
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
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
    color: "#1a1a2e",
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
  badgeType: {
    display: "inline-block",
    padding: "4px 10px",
    fontSize: "12px",
    backgroundColor: "#dbeafe",
    borderRadius: "4px",
    color: "#1d4ed8",
  },
  headerTop: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "8px",
    marginBottom: "20px",
  },
  titleSection: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    flexWrap: "wrap" as const,
  },
  verificationBadge: {
    display: "flex",
    alignItems: "center",
  },
  verifiedBadge: {
    padding: "4px 12px",
    backgroundColor: "#dcfce7",
    color: "#166534",
    borderRadius: "9999px",
    fontSize: "12px",
    fontWeight: 600,
    border: "1px solid #bbf7d0",
  },
  unverifiedBadge: {
    padding: "4px 12px",
    backgroundColor: "#fef2f2",
    color: "#991b1b",
    borderRadius: "9999px",
    fontSize: "12px",
    fontWeight: 600,
    border: "1px solid #fecaca",
  },
  entityDetailsCard: {
    backgroundColor: "white",
    borderRadius: "12px",
    border: "1px solid #e8e8e8",
    padding: "20px",
    marginBottom: "24px",
    boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
  },
  entityDetailsTitle: {
    fontSize: "14px",
    fontWeight: 600,
    color: "#4b5563",
    marginBottom: "16px",
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
  },
  entityDetailsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
    gap: "16px",
  },
  entityDetailItem: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "4px",
  },
  detailLabel: {
    fontSize: "12px",
    color: "#9ca3af",
    fontWeight: 500,
  },
  detailValue: {
    fontSize: "14px",
    color: "#1f2937",
    fontWeight: 500,
  },
  filtersContainer: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "12px",
    marginBottom: "24px",
  },
  dateRangeContainer: {
    display: "flex",
    alignItems: "center",
    gap: "16px",
    flexWrap: "wrap" as const,
  },
  excludeContainer: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    flexWrap: "wrap" as const,
  },
  filterLabel: {
    fontSize: "13px",
    color: "#666",
    fontWeight: 500,
  },
  excludeInput: {
    padding: "8px 12px",
    border: "1px solid #e0e0e0",
    borderRadius: "6px",
    fontSize: "13px",
    backgroundColor: "white",
    color: "#333",
    width: "200px",
  },
  filterButton: {
    padding: "8px 14px",
    border: "1px solid #5c4d3c",
    borderRadius: "6px",
    backgroundColor: "#5c4d3c",
    fontSize: "13px",
    fontWeight: 500,
    color: "white",
    cursor: "pointer",
  },
  clearButton: {
    padding: "8px 14px",
    border: "1px solid #e0e0e0",
    borderRadius: "6px",
    backgroundColor: "white",
    fontSize: "13px",
    fontWeight: 500,
    color: "#666",
    cursor: "pointer",
  },
  datePresets: {
    display: "flex",
    gap: "4px",
  },
  presetButton: {
    padding: "8px 14px",
    border: "1px solid #e0e0e0",
    borderRadius: "6px",
    backgroundColor: "white",
    fontSize: "13px",
    fontWeight: 500,
    color: "#666",
    cursor: "pointer",
  },
  presetButtonActive: {
    backgroundColor: "#5c4d3c",
    color: "white",
    borderColor: "#5c4d3c",
  },
  dateInputs: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
  },
  dateInput: {
    padding: "8px 12px",
    border: "1px solid #e0e0e0",
    borderRadius: "6px",
    fontSize: "13px",
    backgroundColor: "white",
    color: "#333",
  },
  dateSeparator: {
    fontSize: "13px",
    color: "#888",
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
    backgroundColor: "#f8f5f0",
    borderColor: "#e8dfd0",
  },
  summaryValue: {
    fontSize: "28px",
    fontWeight: 600,
    color: "#1a1a2e",
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
    color: "#1a1a2e",
    margin: 0,
  },
  cardTitleRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: "16px",
  },
  clearFilterButton: {
    padding: "4px 10px",
    fontSize: "12px",
    border: "1px solid #e0e0e0",
    borderRadius: "4px",
    backgroundColor: "white",
    color: "#666",
    cursor: "pointer",
  },
  supplierList: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "12px",
  },
  supplierRow: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    padding: "8px",
    borderBottom: "1px solid #f0f0f0",
    borderRadius: "6px",
    margin: "0 -8px",
  },
  supplierRowClickable: {
    cursor: "pointer",
    transition: "background-color 0.15s ease",
  },
  supplierRowSelected: {
    backgroundColor: "#f0e6d6",
    borderColor: "#e0d0b0",
  },
  supplierRank: {
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
  supplierInfo: {
    flex: 1,
    minWidth: 0,
  },
  supplierName: {
    fontSize: "14px",
    fontWeight: 500,
    color: "#1a1a2e",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  },
  supplierMeta: {
    fontSize: "12px",
    color: "#888",
  },
  supplierSpend: {
    fontSize: "14px",
    fontWeight: 600,
    color: "#1a1a2e",
  },
  supplierActions: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
  },
  supplierLink: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "24px",
    height: "24px",
    borderRadius: "4px",
    backgroundColor: "#f0f0f0",
    color: "#666",
    textDecoration: "none",
    fontSize: "14px",
    transition: "background-color 0.15s ease",
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
    backgroundColor: "#fef3c7",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "12px",
    fontWeight: 600,
    color: "#92400e",
  },
  topTxInfo: {
    flex: 1,
    minWidth: 0,
  },
  topTxSupplier: {
    fontSize: "13px",
    fontWeight: 500,
    color: "#1a1a2e",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  },
  topTxDate: {
    fontSize: "11px",
    color: "#888",
  },
  topTxAmount: {
    fontSize: "14px",
    fontWeight: 600,
    color: "#1a1a2e",
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
    backgroundColor: "#5c4d3c",
    borderRadius: "4px",
  },
  monthSpend: {
    width: "80px",
    textAlign: "right" as const,
    fontSize: "13px",
    fontWeight: 500,
    color: "#1a1a2e",
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
  loadingCell: {
    textAlign: "center" as const,
    padding: "48px",
    color: "#888",
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
  pagination: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "16px",
    padding: "16px 0 0 0",
    borderTop: "1px solid #eee",
    marginTop: "16px",
  },
  pageButton: {
    padding: "8px 16px",
    fontSize: "13px",
    border: "1px solid #e0e0e0",
    borderRadius: "6px",
    backgroundColor: "white",
    cursor: "pointer",
  },
  pageInfo: {
    fontSize: "13px",
    color: "#666",
  },
  loading: {
    textAlign: "center" as const,
    padding: "48px",
    color: "#888",
    fontSize: "16px",
  },
  error: {
    backgroundColor: "#fef2f2",
    color: "#dc2626",
    padding: "16px 20px",
    borderRadius: "8px",
    marginBottom: "16px",
    fontSize: "14px",
  },
};

