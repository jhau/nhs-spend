"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

interface Summary {
  totalSpend: number;
  transactionCount: number;
  buyerCount: number;
  earliestDate: string | null;
  latestDate: string | null;
}

interface Buyer {
  id: number;
  name: string;
  trustType: string | null;
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
  buyer_id: number;
  buyer: string;
  amount: string;
  payment_date: string;
}

interface LinkedCompany {
  companyNumber: string;
  companyName: string;
  companyStatus: string;
  companyType: string;
  dateOfCreation: string;
  address: string;
  sicCodes: string[] | null;
}

interface Contract {
  id: string;
  title: string;
  description: string | null;
  buyer: string;
  publishedDate: string;
  awardedDate: string;
  awardedValue: number | null;
  awardedSuppliers: string[] | null;
  totalSuppliers?: number;
  cpvDescription: string | null;
  region: string | null;
  rawData?: any;
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

export default function SupplierPage() {
  const params = useParams();
  const name = decodeURIComponent(params.name as string);

  const [supplierName, setSupplierName] = useState<string>("");
  const [linkedCompany, setLinkedCompany] = useState<LinkedCompany | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [topBuyers, setTopBuyers] = useState<Buyer[]>([]);
  const [monthlySpend, setMonthlySpend] = useState<MonthlySpend[]>([]);
  const [topTransactions, setTopTransactions] = useState<Transaction[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [contractsLoading, setContractsLoading] = useState(false);
  const [contractsSearchInfo, setContractsSearchInfo] = useState<{
    searchMethod: "companies_house" | "keyword";
    searchKeyword: string;
    companiesHouseNumber: string | null;
  } | null>(null);
  const [expandedContracts, setExpandedContracts] = useState<Set<string>>(new Set());
  const [selectedContractDetails, setSelectedContractDetails] = useState<Contract | null>(null);

  // Date range
  const defaultDates = getDefaultDateRange();
  const [startDate, setStartDate] = useState(defaultDates.startDate);
  const [endDate, setEndDate] = useState(defaultDates.endDate);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const queryParams = new URLSearchParams({
        page: currentPage.toString(),
        limit: "50",
        ...(startDate && { startDate }),
        ...(endDate && { endDate }),
      });
      const res = await fetch(`/api/suppliers/${encodeURIComponent(name)}?${queryParams}`);
      if (!res.ok) {
        if (res.status === 404) {
          setError("Supplier not found");
        } else {
          throw new Error("Failed to fetch data");
        }
        return;
      }
      const data = await res.json();
      setSupplierName(data.supplier.name);
      setLinkedCompany(data.linkedCompany);
      setSummary(data.summary);
      setTopBuyers(data.topBuyers);
      setMonthlySpend(data.monthlySpend);
      setTopTransactions(data.topTransactions);
      setTransactions(data.transactions);
      setPagination(data.pagination);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [name, currentPage, startDate, endDate]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Fetch contracts from Contracts Finder API
  const fetchContracts = useCallback(async () => {
    setContractsLoading(true);
    try {
      // API will use Companies House data if available
      const res = await fetch(`/api/suppliers/${encodeURIComponent(name)}/contracts`);
      if (res.ok) {
        const data = await res.json();
        setContracts(data.contracts || []);
        setContractsSearchInfo({
          searchMethod: data.searchMethod,
          searchKeyword: data.searchKeyword,
          companiesHouseNumber: data.companiesHouseNumber,
        });
      }
    } catch (err) {
      console.error("Failed to fetch contracts:", err);
    } finally {
      setContractsLoading(false);
    }
  }, [name]);

  // Fetch contracts when component mounts
  useEffect(() => {
    fetchContracts();
  }, [fetchContracts]);

  const toggleContractExpansion = (contractId: string) => {
    setExpandedContracts((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(contractId)) {
        newSet.delete(contractId);
      } else {
        newSet.add(contractId);
      }
      return newSet;
    });
  };

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

  if (loading && !supplierName) {
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
        <h1 style={styles.title}>{supplierName}</h1>
        {linkedCompany && (
          <div style={styles.meta}>
            <span style={styles.badge}>
              <a
                href={`https://find-and-update.company-information.service.gov.uk/company/${linkedCompany.companyNumber}`}
                target="_blank"
                rel="noopener noreferrer"
                style={styles.companyLink}
              >
                Companies House: {linkedCompany.companyNumber}
              </a>
            </span>
            <span style={{
              ...styles.badgeStatus,
              backgroundColor: linkedCompany.companyStatus === "active" ? "#dcfce7" : "#fef3c7",
              color: linkedCompany.companyStatus === "active" ? "#166534" : "#92400e",
            }}>
              {linkedCompany.companyStatus}
            </span>
            {linkedCompany.address && (
              <span style={styles.badge}>{linkedCompany.address}</span>
            )}
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
      </div>

      {/* Summary Cards */}
      {summary && (
        <div style={styles.summaryGrid}>
          <div style={{ ...styles.summaryCard, ...styles.summaryCardHighlight }}>
            <div style={styles.summaryValue}>
              {formatCurrency(summary.totalSpend)}
            </div>
            <div style={styles.summaryLabel}>Total Received</div>
          </div>
          <div style={styles.summaryCard}>
            <div style={styles.summaryValue}>
              {formatNumber(summary.transactionCount)}
            </div>
            <div style={styles.summaryLabel}>Transactions</div>
          </div>
          <div style={styles.summaryCard}>
            <div style={styles.summaryValue}>
              {formatNumber(summary.buyerCount)}
            </div>
            <div style={styles.summaryLabel}>NHS Buyers</div>
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
        {/* Top Buyers */}
        <div style={styles.card}>
          <h2 style={{ ...styles.cardTitle, marginBottom: "16px" }}>Top NHS Buyers</h2>
          <div style={styles.buyerList}>
            {topBuyers.length === 0 ? (
              <div style={styles.emptyState}>No buyer data</div>
            ) : (
              topBuyers.map((buyer, index) => (
                <Link
                  key={buyer.id}
                  href={`/buyers/${buyer.id}`}
                  style={{ textDecoration: "none" }}
                >
                  <div style={styles.buyerRow}>
                    <div style={styles.buyerRank}>{index + 1}</div>
                    <div style={styles.buyerInfo}>
                      <div style={styles.buyerName}>{buyer.name}</div>
                      <div style={styles.buyerMeta}>
                        {formatNumber(buyer.transactionCount)} transactions
                      </div>
                    </div>
                    <div style={styles.buyerSpend}>
                      {formatCurrency(buyer.totalSpend)}
                    </div>
                  </div>
                </Link>
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
                    <Link href={`/buyers/${tx.buyer_id}`} style={styles.topTxBuyer}>
                      {tx.buyer}
                    </Link>
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
          <h2 style={{ ...styles.cardTitle, marginBottom: "16px" }}>Monthly Payments</h2>
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
        <h2 style={{ ...styles.cardTitle, marginBottom: "16px" }}>Recent Transactions</h2>
        <div style={styles.tableContainer}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Date</th>
                <th style={styles.th}>Buyer</th>
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
                    <td style={styles.td}>
                      <Link href={`/buyers/${tx.buyer_id}`} style={styles.buyerLink}>
                        {tx.buyer}
                      </Link>
                    </td>
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

      {/* Contracts Finder Section */}
      <div style={styles.card}>
        <div style={styles.contractsHeader}>
          <h2 style={{ ...styles.cardTitle, marginBottom: 0 }}>
            UK Government Contracts
          </h2>
          <span style={styles.contractsSource}>
            via{" "}
            <a
              href="https://www.contractsfinder.service.gov.uk/"
              target="_blank"
              rel="noopener noreferrer"
              style={styles.sourceLink}
            >
              Contracts Finder
            </a>
          </span>
        </div>
        <p style={styles.contractsSubtitle}>
          Awarded public sector contracts from the UK Government&apos;s Contracts Finder
        </p>
        
        {/* Search method indicator */}
        {contractsSearchInfo && (
          <div style={styles.searchMethodBanner}>
            {contractsSearchInfo.searchMethod === "companies_house" ? (
              <>
                <span style={styles.searchMethodIcon}>✓</span>
                <span>
                  Searching by Companies House name:{" "}
                  <strong>{contractsSearchInfo.searchKeyword}</strong>
                  {contractsSearchInfo.companiesHouseNumber && (
                    <span style={styles.companyNumber}>
                      ({contractsSearchInfo.companiesHouseNumber})
                    </span>
                  )}
                </span>
              </>
            ) : (
              <>
                <span style={styles.searchMethodIconWarn}>⚠</span>
                <span>
                  Searching by supplier name: <strong>{contractsSearchInfo.searchKeyword}</strong>
                  <span style={styles.searchMethodNote}>
                    {" "}— No Companies House link available, results may include unrelated contracts
                  </span>
                </span>
              </>
            )}
          </div>
        )}
        
        {contractsLoading ? (
          <div style={styles.emptyState}>Loading contracts...</div>
        ) : contracts.length === 0 ? (
          <div style={styles.emptyState}>
            <div>No verified contracts found</div>
            <div style={styles.emptyStateNote}>
              Only contracts with this supplier explicitly listed in the &quot;Awarded to&quot; section are shown.
              Many contracts on Contracts Finder don&apos;t include structured supplier data.
            </div>
          </div>
        ) : (
          <div style={styles.contractsList}>
            {contracts.map((contract) => (
              <div key={contract.id} style={styles.contractCardWrapper}>
                <a
                  href={`https://www.contractsfinder.service.gov.uk/Notice/${contract.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={styles.contractCard}
                >
                <div style={styles.contractTitle}>{contract.title}</div>
                <div style={styles.contractMeta}>
                  <span style={styles.contractBuyer}>{contract.buyer}</span>
                  {contract.awardedValue && (
                    <span style={styles.contractValue}>
                      £{contract.awardedValue.toLocaleString("en-GB")}
                    </span>
                  )}
                </div>
                {/* Show awarded suppliers clearly */}
                {contract.awardedSuppliers && contract.awardedSuppliers.length > 0 && (
                  <div style={styles.awardedSuppliers}>
                    <span style={styles.awardedLabel}>Awarded to:</span>
                    {(() => {
                      const isExpanded = expandedContracts.has(contract.id);
                      const displaySuppliers = isExpanded
                        ? contract.awardedSuppliers
                        : contract.awardedSuppliers.slice(0, 3);
                      const hasMore = contract.awardedSuppliers.length > 3;

                      return (
                        <>
                          {displaySuppliers.map((supplier, idx) => (
                            <span key={idx} style={styles.awardedSupplier}>
                              {supplier}
                            </span>
                          ))}
                          {hasMore && (
                            <button
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                toggleContractExpansion(contract.id);
                              }}
                              style={styles.expandButton}
                            >
                              {isExpanded
                                ? `Show less (${contract.awardedSuppliers.length - 3} fewer)`
                                : `+${contract.awardedSuppliers.length - 3} more`}
                            </button>
                          )}
                        </>
                      );
                    })()}
                  </div>
                )}
                {contract.description && (
                  <div style={styles.contractDescription}>
                    {contract.description}
                    {contract.description.length >= 300 ? "..." : ""}
                  </div>
                )}
                <div style={styles.contractFooter}>
                  {contract.awardedDate && (
                    <span style={styles.contractDate}>
                      Awarded: {formatDate(contract.awardedDate)}
                    </span>
                  )}
                {contract.cpvDescription && (
                  <span style={styles.contractCpv}>{contract.cpvDescription}</span>
                )}
              </div>
              </a>
              <div style={styles.contractActions}>
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setSelectedContractDetails(contract);
                  }}
                  style={styles.viewDetailsButton}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = "#f8f9fa";
                    e.currentTarget.style.borderColor = "#d0d0d0";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = "white";
                    e.currentTarget.style.borderColor = "#e8e8e8";
                  }}
                >
                  View Details
                </button>
              </div>
            </div>
            ))}
          </div>
        )}
      </div>

      {/* Contract Details Modal */}
      {selectedContractDetails && (
        <div
          style={styles.modalOverlay}
          onClick={() => setSelectedContractDetails(null)}
        >
          <div
            style={styles.modalContent}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={styles.modalHeader}>
              <h2 style={styles.modalTitle}>Contract Details</h2>
              <button
                onClick={() => setSelectedContractDetails(null)}
                style={styles.modalCloseButton}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = "#f0f0f0";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = "transparent";
                }}
              >
                ×
              </button>
            </div>
            <div style={styles.modalBody}>
              {selectedContractDetails.rawData ? (
                <pre style={styles.jsonDisplay}>
                  {JSON.stringify(selectedContractDetails.rawData, null, 2)}
                </pre>
              ) : (
                <div style={styles.noRawData}>
                  <div>Raw contract data not available</div>
                  <div style={{ marginTop: "12px", fontSize: "12px", color: "#aaa" }}>
                    This contract may have been cached before raw data storage was implemented.
                    Try refreshing the page to fetch fresh data.
                  </div>
                  <div style={{ marginTop: "12px", fontSize: "12px", color: "#666" }}>
                    Available contract data:
                  </div>
                  <pre style={{ ...styles.jsonDisplay, marginTop: "8px" }}>
                    {JSON.stringify({
                      id: selectedContractDetails.id,
                      title: selectedContractDetails.title,
                      description: selectedContractDetails.description,
                      buyer: selectedContractDetails.buyer,
                      publishedDate: selectedContractDetails.publishedDate,
                      awardedDate: selectedContractDetails.awardedDate,
                      awardedValue: selectedContractDetails.awardedValue,
                      awardedSuppliers: selectedContractDetails.awardedSuppliers,
                      cpvDescription: selectedContractDetails.cpvDescription,
                      region: selectedContractDetails.region,
                    }, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
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
    backgroundColor: "#f0f8f0",
    borderColor: "#d0e8d0",
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
    color: "#1a1a2e",
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
    color: "#1a1a2e",
  },
  buyerLink: {
    color: "#5c4d3c",
    textDecoration: "none",
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
    backgroundColor: "#22c55e",
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
  emptyStateNote: {
    fontSize: "12px",
    color: "#aaa",
    marginTop: "8px",
    maxWidth: "400px",
    marginLeft: "auto",
    marginRight: "auto",
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
  contractsHeader: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    marginBottom: "4px",
  },
  contractsSource: {
    fontSize: "12px",
    color: "#888",
  },
  sourceLink: {
    color: "#5c4d3c",
    textDecoration: "none",
  },
  contractsSubtitle: {
    fontSize: "13px",
    color: "#666",
    marginBottom: "12px",
  },
  searchMethodBanner: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "10px 14px",
    borderRadius: "6px",
    fontSize: "13px",
    marginBottom: "16px",
    backgroundColor: "#f8f9fa",
    border: "1px solid #e8e8e8",
  },
  searchMethodIcon: {
    color: "#166534",
    fontSize: "14px",
    fontWeight: 600,
  },
  searchMethodIconWarn: {
    color: "#b45309",
    fontSize: "14px",
  },
  companyNumber: {
    color: "#888",
    marginLeft: "4px",
    fontFamily: "monospace",
    fontSize: "12px",
  },
  searchMethodNote: {
    color: "#888",
    fontSize: "12px",
  },
  contractsList: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "12px",
  },
  contractCardWrapper: {
    position: "relative" as const,
    borderRadius: "8px",
    border: "1px solid #e8e8e8",
    backgroundColor: "#fafafa",
    overflow: "hidden",
  },
  contractCard: {
    display: "block",
    padding: "16px",
    paddingRight: "120px",
    textDecoration: "none",
    transition: "border-color 0.15s ease, background-color 0.15s ease",
    cursor: "pointer",
  },
  contractTitle: {
    fontSize: "15px",
    fontWeight: 600,
    color: "#1a1a2e",
    marginBottom: "8px",
    lineHeight: 1.4,
  },
  contractMeta: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    marginBottom: "8px",
  },
  contractBuyer: {
    fontSize: "13px",
    color: "#5c4d3c",
    fontWeight: 500,
  },
  contractValue: {
    fontSize: "14px",
    fontWeight: 600,
    color: "#166534",
    backgroundColor: "#dcfce7",
    padding: "2px 8px",
    borderRadius: "4px",
  },
  awardedSuppliers: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    flexWrap: "wrap" as const,
    marginBottom: "8px",
  },
  awardedLabel: {
    fontSize: "12px",
    color: "#666",
    fontWeight: 500,
  },
  awardedSupplier: {
    fontSize: "12px",
    color: "#1a1a2e",
    backgroundColor: "#e8f4fc",
    padding: "2px 8px",
    borderRadius: "4px",
    border: "1px solid #c4dff0",
  },
  expandButton: {
    fontSize: "12px",
    color: "#5c4d3c",
    backgroundColor: "transparent",
    border: "none",
    padding: "4px 8px",
    cursor: "pointer",
    textDecoration: "underline",
    fontFamily: "inherit",
  },
  contractDescription: {
    fontSize: "13px",
    color: "#555",
    lineHeight: 1.5,
    marginBottom: "8px",
  },
  contractFooter: {
    display: "flex",
    alignItems: "center",
    gap: "16px",
    flexWrap: "wrap" as const,
  },
  contractDate: {
    fontSize: "12px",
    color: "#888",
  },
  contractCpv: {
    fontSize: "12px",
    color: "#666",
    backgroundColor: "#f0f0f0",
    padding: "2px 8px",
    borderRadius: "4px",
  },
  contractActions: {
    position: "absolute" as const,
    top: "16px",
    right: "16px",
    zIndex: 10,
  },
  viewDetailsButton: {
    padding: "6px 12px",
    fontSize: "12px",
    fontWeight: 500,
    color: "#5c4d3c",
    backgroundColor: "white",
    border: "1px solid #e8e8e8",
    borderRadius: "6px",
    cursor: "pointer",
    transition: "background-color 0.15s ease, border-color 0.15s ease",
    boxShadow: "0 1px 2px rgba(0, 0, 0, 0.05)",
  },
  modalOverlay: {
    position: "fixed" as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
    padding: "20px",
  },
  modalContent: {
    backgroundColor: "white",
    borderRadius: "12px",
    maxWidth: "90vw",
    maxHeight: "90vh",
    width: "800px",
    display: "flex",
    flexDirection: "column" as const,
    boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
  },
  modalHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "20px 24px",
    borderBottom: "1px solid #e8e8e8",
  },
  modalTitle: {
    fontSize: "18px",
    fontWeight: 600,
    color: "#1a1a2e",
    margin: 0,
  },
  modalCloseButton: {
    fontSize: "28px",
    fontWeight: 300,
    color: "#888",
    backgroundColor: "transparent",
    border: "none",
    cursor: "pointer",
    padding: 0,
    width: "32px",
    height: "32px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "4px",
    transition: "background-color 0.15s ease",
  },
  modalBody: {
    padding: "24px",
    overflow: "auto",
    flex: 1,
  },
  jsonDisplay: {
    fontSize: "12px",
    fontFamily: "'Monaco', 'Menlo', 'Ubuntu Mono', monospace",
    backgroundColor: "#f8f9fa",
    padding: "16px",
    borderRadius: "8px",
    border: "1px solid #e8e8e8",
    overflow: "auto",
    margin: 0,
    lineHeight: 1.5,
    color: "#333",
    maxHeight: "calc(90vh - 120px)",
  },
  noRawData: {
    textAlign: "center" as const,
    padding: "48px",
    color: "#888",
    fontSize: "14px",
  },
};

