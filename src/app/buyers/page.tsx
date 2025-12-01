"use client";

import { useEffect, useState, useCallback } from "react";
import RegionalActivity from "./RegionalActivity";

interface Buyer {
  id: number;
  name: string;
  trust_type: string | null;
  total_spend: string;
  supplier_count: number;
  top_supplier: string | null;
}

interface ParentOrg {
  id: number;
  name: string;
  total_spend: string;
  supplier_count: number;
}

interface Summary {
  totalBuyers: number;
  activeLast90Days: number;
  totalSpend: number;
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

// Get default date range (previous year)
function getDefaultDateRange() {
  const currentYear = new Date().getFullYear();
  const previousYear = currentYear - 1;
  return {
    startDate: `${previousYear}-01-01`,
    endDate: `${previousYear}-12-31`,
  };
}

export default function BuyersPage() {
  const [buyers, setBuyers] = useState<Buyer[]>([]);
  const [parentOrgs, setParentOrgs] = useState<ParentOrg[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [activeTab, setActiveTab] = useState<"listings" | "regional">("listings");
  
  // Date range state with previous year as default
  const defaultDates = getDefaultDateRange();
  const [startDate, setStartDate] = useState(defaultDates.startDate);
  const [endDate, setEndDate] = useState(defaultDates.endDate);

  const fetchBuyers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: currentPage.toString(),
        limit: "20",
        ...(search && { search }),
        ...(startDate && { startDate }),
        ...(endDate && { endDate }),
      });
      const res = await fetch(`/api/buyers?${params}`);
      if (!res.ok) throw new Error("Failed to fetch data");
      const data = await res.json();
      setBuyers(data.buyers);
      setParentOrgs(data.parentOrganisations || []);
      setSummary(data.summary);
      setPagination(data.pagination);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [currentPage, search, startDate, endDate]);

  useEffect(() => {
    fetchBuyers();
  }, [fetchBuyers]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearch(searchInput);
    setCurrentPage(1);
  };
  
  const handleDateChange = () => {
    setCurrentPage(1);
  };

  // Quick date presets
  const setDatePreset = (preset: string) => {
    const currentYear = new Date().getFullYear();
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

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <h1 style={styles.title}>Spend Data - Buyers</h1>
        <div style={styles.headerRow}>
        <div style={styles.tabs}>
            <button 
              style={{ ...styles.tab, ...(activeTab === "listings" ? styles.tabActive : {}) }}
              onClick={() => setActiveTab("listings")}
            >
              All listings
            </button>
            <button 
              style={{ ...styles.tab, ...(activeTab === "regional" ? styles.tabActive : {}) }}
              onClick={() => setActiveTab("regional")}
            >
              Regional activity
            </button>
          </div>
          
          {/* Date Range Selector */}
          <div style={styles.dateRangeContainer}>
            <div style={styles.datePresets}>
              <button
                style={{
                  ...styles.presetButton,
                  ...(startDate === "2024-01-01" && endDate === "2024-12-31" ? styles.presetButtonActive : {}),
                }}
                onClick={() => setDatePreset("2024")}
              >
                2024
              </button>
              <button
                style={{
                  ...styles.presetButton,
                  ...(startDate === "2023-01-01" && endDate === "2023-12-31" ? styles.presetButtonActive : {}),
                }}
                onClick={() => setDatePreset("2023")}
              >
                2023
              </button>
              <button
                style={{
                  ...styles.presetButton,
                  ...(startDate === "2022-01-01" && endDate === "2022-12-31" ? styles.presetButtonActive : {}),
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
                onChange={(e) => { setStartDate(e.target.value); handleDateChange(); }}
                style={styles.dateInput}
              />
              <span style={styles.dateSeparator}>to</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => { setEndDate(e.target.value); handleDateChange(); }}
                style={styles.dateInput}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === "regional" ? (
        <RegionalActivity startDate={startDate} endDate={endDate} />
      ) : (
        <>
      {/* Parent Organisations - National/Regional Bodies */}
      {parentOrgs.length > 0 && (
        <div style={styles.parentOrgsSection}>
          <h2 style={styles.sectionTitle}>National Bodies</h2>
          <div style={styles.parentOrgsGrid}>
            {parentOrgs.map((org) => (
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
        <h2 style={styles.sectionTitle}>Sub-Organisations Overview</h2>
      <div style={styles.summaryGrid}>
        <SummaryCard
          value={summary ? formatNumber(summary.totalBuyers) : "—"}
            label="Total sub-organisations"
          loading={loading}
        />
        <SummaryCard
          value={summary ? formatNumber(summary.activeLast90Days) : "—"}
          label="Active last 90 days"
          loading={loading}
        />
        <SummaryCard
          value={summary ? formatCurrency(summary.totalSpend) : "—"}
          label="Total spend recorded"
          loading={loading}
          highlight
        />
        <SummaryCard
          value={pagination ? formatNumber(pagination.total) : "—"}
          label="Organisations with data"
          loading={loading}
        />
        </div>
      </div>

      {/* Search */}
      <form onSubmit={handleSearch} style={styles.searchContainer}>
        <input
          type="text"
          placeholder="Search buyers by name..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          style={styles.searchInput}
        />
        <button type="submit" style={styles.searchButton}>
          Search
        </button>
      </form>

      {/* Error State */}
      {error && <div style={styles.error}>{error}</div>}

      {/* Data Table */}
      <div style={styles.tableContainer}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Buyer</th>
              <th style={styles.th}>Type</th>
              <th style={{ ...styles.th, textAlign: "right" }}>Total Spend</th>
              <th style={styles.th}>Top Supplier</th>
              <th style={{ ...styles.th, textAlign: "center" }}># of Suppliers</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} style={styles.loadingCell}>
                  <div style={styles.spinner} />
                  Loading...
                </td>
              </tr>
            ) : buyers.length === 0 ? (
              <tr>
                <td colSpan={5} style={styles.emptyCell}>
                  No buyers found
                </td>
              </tr>
            ) : (
              buyers.map((buyer) => (
                <tr key={buyer.id} style={styles.tr}>
                  <td style={styles.td}>
                    <span style={styles.buyerName}>{buyer.name}</span>
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
            Page {pagination.page} of {pagination.totalPages}
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
        </>
      )}
    </div>
  );
}

function SummaryCard({
  value,
  label,
  loading,
  highlight,
}: {
  value: string;
  label: string;
  loading?: boolean;
  highlight?: boolean;
}) {
  return (
    <div
      style={{
        ...styles.summaryCard,
        ...(highlight ? styles.summaryCardHighlight : {}),
      }}
    >
      <div style={{ ...styles.summaryValue, ...(loading ? { opacity: 0.5 } : {}) }}>
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
  tabs: {
    display: "flex",
    gap: "8px",
  },
  tab: {
    padding: "10px 20px",
    border: "1px solid #e0e0e0",
    borderRadius: "6px",
    backgroundColor: "white",
    fontSize: "14px",
    fontWeight: 500,
    color: "#666",
    cursor: "pointer",
  },
  tabActive: {
    backgroundColor: "#1a1a2e",
    color: "white",
    borderColor: "#1a1a2e",
  },
  dateRangeContainer: {
    display: "flex",
    alignItems: "center",
    gap: "16px",
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
  searchContainer: {
    display: "flex",
    gap: "12px",
    marginBottom: "16px",
  },
  searchInput: {
    flex: 1,
    padding: "14px 18px",
    fontSize: "14px",
    border: "1px solid #e0e0e0",
    borderRadius: "8px",
    backgroundColor: "white",
    outline: "none",
  },
  searchButton: {
    padding: "14px 28px",
    fontSize: "14px",
    fontWeight: 500,
    backgroundColor: "#1a1a2e",
    color: "white",
    border: "none",
    borderRadius: "8px",
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
  typeTag: {
    display: "inline-block",
    padding: "4px 10px",
    fontSize: "12px",
    backgroundColor: "#f0f0f0",
    borderRadius: "4px",
    color: "#666",
  },
  supplierLink: {
    color: "#5c4d3c",
    textDecoration: "underline",
    cursor: "pointer",
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
  spinner: {
    width: "20px",
    height: "20px",
    border: "2px solid #e0e0e0",
    borderTopColor: "#1a1a2e",
    borderRadius: "50%",
    animation: "spin 0.8s linear infinite",
    display: "inline-block",
    marginRight: "8px",
  },
  pagination: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "16px",
    padding: "24px",
  },
  pageButton: {
    padding: "10px 20px",
    fontSize: "14px",
    border: "1px solid #e0e0e0",
    borderRadius: "6px",
    backgroundColor: "white",
    cursor: "pointer",
  },
  pageInfo: {
    fontSize: "14px",
    color: "#666",
  },
  error: {
    backgroundColor: "#fef2f2",
    color: "#dc2626",
    padding: "12px 16px",
    borderRadius: "8px",
    marginBottom: "16px",
    fontSize: "14px",
  },
};

