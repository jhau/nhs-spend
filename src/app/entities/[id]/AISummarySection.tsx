"use client";

import { useEffect, useState } from "react";

interface AISummaryData {
  summary: string;
  news: { title: string; link: string; date?: string }[];
}

export function AISummarySection({ entityId, initialData }: { entityId: number, initialData: AISummaryData | null }) {
  const [data, setData] = useState<AISummaryData | null>(initialData);
  const [loading, setLoading] = useState(!initialData);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState(false);

  async function fetchSummary(force: boolean = false) {
    if (force) setIsRefreshing(true);
    else setLoading(true);
    
    try {
      const res = await fetch(`/api/entities/${entityId}/ai-summary${force ? "?force=true" : ""}`);
      if (!res.ok) throw new Error();
      const json = await res.json();
      setData(json);
      setError(false);
    } catch (err) {
      setError(true);
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }

  useEffect(() => {
    if (initialData && initialData.summary) {
      return;
    }

    fetchSummary();
  }, [entityId, initialData]);

  if (loading) {
    return (
      <div style={styles.card}>
        <div style={styles.loadingContainer}>
          <div style={styles.spinner} />
          <span style={styles.loadingText}>Generating AI Insights...</span>
        </div>
      </div>
    );
  }

  if (error || !data || !data.summary) return null;

  return (
    <div style={{ ...styles.card, marginBottom: "24px", position: "relative" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "20px" }}>✨</span>
          <h2 style={styles.cardTitle}>AI Insights & News</h2>
          {isRefreshing && (
            <div style={{ ...styles.spinner, width: "14px", height: "14px", borderWidth: "1.5px" }} />
          )}
        </div>
        <button 
          onClick={() => fetchSummary(true)}
          disabled={isRefreshing}
          style={{
            fontSize: "12px",
            color: "#6b7280",
            backgroundColor: "transparent",
            border: "1px solid #e5e7eb",
            borderRadius: "6px",
            padding: "4px 8px",
            cursor: isRefreshing ? "not-allowed" : "pointer",
            display: "flex",
            alignItems: "center",
            gap: "4px",
            transition: "all 0.2s"
          }}
          onMouseOver={(e) => {
            if (!isRefreshing) {
              e.currentTarget.style.backgroundColor = "#f9fafb";
              e.currentTarget.style.borderColor = "#d1d5db";
            }
          }}
          onMouseOut={(e) => {
            if (!isRefreshing) {
              e.currentTarget.style.backgroundColor = "transparent";
              e.currentTarget.style.borderColor = "#e5e7eb";
            }
          }}
        >
          {isRefreshing ? "Regenerating..." : "Regenerate"}
        </button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "24px", opacity: isRefreshing ? 0.6 : 1, transition: "opacity 0.2s" }}>
        <div style={{ fontSize: "15px", lineHeight: "1.6", color: "#374151" }}>
          {data.summary}
        </div>
        {data.news && data.news.length > 0 && (
          <div style={{ borderLeft: "1px solid #e5e7eb", paddingLeft: "24px" }}>
            <h3 style={{ fontSize: "13px", fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "12px" }}>
              Latest News
            </h3>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  {data.news.map((news: any, i: number) => (
                    <div key={i} style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                      <a 
                        href={news.link} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        style={{ 
                          fontSize: "14px", 
                          color: "#2563eb", 
                          textDecoration: "none",
                          display: "block",
                          fontWeight: 500,
                          lineHeight: "1.4"
                        }}
                      >
                        {news.title}
                      </a>
                      {news.date && (
                        <span style={{ fontSize: "11px", color: "#9ca3af" }}>
                          {news.date}
                        </span>
                      )}
                    </div>
                  ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const styles: { [key: string]: React.CSSProperties } = {
  card: {
    backgroundColor: "white",
    borderRadius: "12px",
    border: "1px solid #e8e8e8",
    padding: "24px",
    marginBottom: "24px",
  },
  cardTitle: {
    fontSize: "16px",
    fontWeight: 600,
    color: "#1a1a2e",
    margin: 0,
  },
  loadingContainer: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "12px",
    padding: "20px 0",
  },
  spinner: {
    width: "20px",
    height: "20px",
    border: "2px solid #f3f3f3",
    borderTop: "2px solid #2563eb",
    borderRadius: "50%",
    animation: "spin 1s linear infinite",
  },
  loadingText: {
    fontSize: "14px",
    color: "#6b7280",
  }
};

// Add the keyframes to the document if possible, or use global CSS
if (typeof document !== 'undefined') {
  const style = document.createElement('style');
  style.innerHTML = `
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
  `;
  document.head.appendChild(style);
}

