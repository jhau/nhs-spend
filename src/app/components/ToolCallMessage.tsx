const styles = {
  card: {
    borderRadius: "0.75rem",
    border: "1px solid #e8e8e8",
    padding: "1rem",
    boxShadow: "0 2px 8px rgba(0, 0, 0, 0.04)",
  },
  cardHeading: {
    marginBottom: "0.5rem",
    textTransform: "uppercase" as const,
    letterSpacing: "0.08em",
    fontSize: "0.7rem",
    fontWeight: 700,
    color: "#888",
  },
  cardBody: {
    whiteSpace: "pre-wrap" as const,
    fontSize: "0.95rem",
    lineHeight: 1.6,
    color: "#333",
  },
};

interface ToolCallMessageProps {
  toolName: string;
  args: unknown;
}

export function ToolCallMessage({ toolName, args }: ToolCallMessageProps) {
  const backgroundColor = "#faf5ff"; // Light purple
  const borderColor = "#e9d5ff";

  return (
    <article style={{ ...styles.card, backgroundColor, borderColor }}>
      <header style={styles.cardHeading}>🔧 Tool Call: {toolName}</header>
      <div style={styles.cardBody}>
        <strong style={{ fontSize: "0.85rem", color: "#6b21a8" }}>Arguments:</strong>
        <div style={{ marginTop: "0.25rem", fontFamily: "monospace", fontSize: "0.85rem" }}>
          {typeof args === "string" ? args : JSON.stringify(args, null, 2)}
        </div>
      </div>
    </article>
  );
}

