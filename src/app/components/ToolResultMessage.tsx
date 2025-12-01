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

interface ToolResultMessageProps {
  toolName: string;
  result: unknown;
}

export function ToolResultMessage({ toolName, result }: ToolResultMessageProps) {
  const backgroundColor = "rgba(16, 185, 129, 0.15)";
  const borderColor = "rgba(16, 185, 129, 0.4)";

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
      <p style={styles.cardBody}>{formattedResult}</p>
    </article>
  );
}

