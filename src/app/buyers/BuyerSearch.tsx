"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export function BuyerSearch() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const searchFilter = searchParams.get("search") || "";
  const [searchInput, setSearchInput] = useState(searchFilter);

  useEffect(() => {
    setSearchInput(searchFilter);
  }, [searchFilter]);

  const onSearch = (e?: React.FormEvent) => {
    e?.preventDefault();
    const params = new URLSearchParams(searchParams.toString());
    if (searchInput) {
      params.set("search", searchInput);
    } else {
      params.delete("search");
    }
    params.set("page", "1");
    router.push(`?${params.toString()}`);
  };

  return (
    <form onSubmit={onSearch} style={styles.searchContainer}>
      <input
        type="text"
        placeholder="Search NHS buyers by name..."
        value={searchInput}
        onChange={(e) => setSearchInput(e.target.value)}
        style={styles.searchInput}
      />
      <button type="submit" style={styles.searchButton}>
        Search
      </button>
    </form>
  );
}

const styles = {
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
};

