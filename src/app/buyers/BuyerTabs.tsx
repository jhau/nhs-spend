"use client";

import { useRouter, useSearchParams } from "next/navigation";

export function BuyerTabs() {
  const router = useRouter();
  const searchParams = useSearchParams();
  
  const tabParam = searchParams.get("tab");
  const activeTab = tabParam === "regional" ? "regional" : "listings";

  const setActiveTab = (tab: "listings" | "regional") => {
    const params = new URLSearchParams(searchParams.toString());
    if (tab === "listings") {
      params.delete("tab");
      params.delete("region");
    } else {
      params.set("tab", tab);
    }
    router.push(`?${params.toString()}`);
  };

  return (
    <div style={styles.tabs}>
      <button 
        style={{ ...styles.tab, ...(activeTab === "listings" ? styles.tabActive : {}) }}
        onClick={() => setActiveTab("listings")}
      >
        All NHS listings
      </button>
      <button 
        style={{ ...styles.tab, ...(activeTab === "regional" ? styles.tabActive : {}) }}
        onClick={() => setActiveTab("regional")}
      >
        Regional NHS activity
      </button>
    </div>
  );
}

const styles: { [key: string]: React.CSSProperties } = {
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
};

