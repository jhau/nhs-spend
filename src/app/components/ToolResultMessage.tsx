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
    fontSize: "0.9rem",
    lineHeight: 1.6,
    color: "#333",
    fontFamily: "monospace",
  },
};

interface ToolResultMessageProps {
  toolName: string;
  result: unknown;
}

export function ToolResultMessage({ toolName, result }: ToolResultMessageProps) {
  const backgroundColor = "#ecfdf5"; // Light emerald
  const borderColor = "#d1fae5";

  // Format result based on type
  let formattedResult: string;
  if (typeof result === "string") {
    formattedResult = result;
  } else if (typeof result === "object" && result !== null) {
    const resultObj = result as Record<string, unknown>;
    // Check if it's a content array format
    if (Array.isArray(resultObj.content)) {
      formattedResult = resultObj.content
        .map((item: any) => {
          if (typeof item === "string") return item;
          if (item.type === "text" && item.text) return item.text;
          return JSON.stringify(item);
        })
        .join("\n");
    } else {
      formattedResult = JSON.stringify(result, null, 2);
    }
  } else {
    formattedResult = String(result);
  }

  return (
    <article style={{ ...styles.card, backgroundColor, borderColor }}>
      <header style={styles.cardHeading}>✓ Tool Result: {toolName}</header>
      <div style={styles.cardBody}>{formattedResult}</div>
    </article>
  );
}

