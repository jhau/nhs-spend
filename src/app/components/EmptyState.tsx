const styles = {
  emptyState: {
    height: "100%",
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    justifyContent: "center",
    gap: "0.75rem",
    textAlign: "center" as const,
    color: "#cbd5f5",
  },
  emptyHeading: { fontSize: "1.05rem", fontWeight: 600 },
  emptyCopy: { maxWidth: "42rem", fontSize: "0.9rem", color: "#94a3b8" },
};

export function EmptyState() {
  return (
    <div style={styles.emptyState}>
      <h2 style={styles.emptyHeading}>Start exploring the data</h2>
      <p style={styles.emptyCopy}>
        Ask domain questions such as "Which suppliers received the most in
        2023?" or "How many payments were recorded for Manchester University NHS
        Foundation Trust in March 2022?". The assistant will query the database
        for precise answers.
      </p>
    </div>
  );
}

