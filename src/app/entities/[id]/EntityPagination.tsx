"use client";

import { useRouter, useSearchParams } from "next/navigation";

interface EntityPaginationProps {
  page: number;
  totalPages: number;
  total: number;
}

export function EntityPagination({ page, totalPages, total }: EntityPaginationProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const setPage = (newPage: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("page", newPage.toString());
    router.push(`?${params.toString()}`);
  };

  return (
    <div style={styles.pagination}>
      <button
        onClick={() => setPage(Math.max(1, page - 1))}
        disabled={page === 1}
        style={{ ...styles.pageButton, opacity: page === 1 ? 0.5 : 1 }}
      >
        Previous
      </button>
      <span style={styles.pageInfo}>
        Page {page} of {totalPages} ({total.toLocaleString("en-GB")} transactions)
      </span>
      <button
        onClick={() => setPage(Math.min(totalPages, page + 1))}
        disabled={page === totalPages}
        style={{ ...styles.pageButton, opacity: page === totalPages ? 0.5 : 1 }}
      >
        Next
      </button>
    </div>
  );
}

const styles: { [key: string]: React.CSSProperties } = {
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
};

