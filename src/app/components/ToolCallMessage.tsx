const styles = {
  card: {
    borderRadius: "0.75rem",
    border: "1px solid #1e293b",
    padding: "1rem",
    boxShadow: "0 4px 12px rgba(15, 23, 42, 0.25)",
  },
  cardHeading: {
    marginBottom: "0.4rem",
    textTransform: "uppercase" as const,
    letterSpacing: "0.08em",
    fontSize: "0.75rem",
    color: "#cbd5f5",
  },
  cardBody: {
    whiteSpace: "pre-wrap" as const,
    fontSize: "0.95rem",
    lineHeight: 1.6,
  },
};

interface ToolCallMessageProps {
  toolName: string;
  args: unknown;
}

export function ToolCallMessage({ toolName, args }: ToolCallMessageProps) {
  const backgroundColor = "rgba(168, 85, 247, 0.15)";
  const borderColor = "rgba(168, 85, 247, 0.4)";

  return (
    <article style={{ ...styles.card, backgroundColor, borderColor }}>
      <header style={styles.cardHeading}>🔧 Tool Call: {toolName}</header>
      <p style={styles.cardBody}>
        <strong>Arguments:</strong>
        <br />
        {typeof args === "string" ? args : JSON.stringify(args, null, 2)}
      </p>
    </article>
  );
}

