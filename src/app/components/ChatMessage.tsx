"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github-dark.css";

type MessageRole = "user" | "assistant" | "tool" | "system";

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
    fontSize: "0.95rem",
    lineHeight: 1.6,
  },
};

const markdownStyles = `
  .markdown-content {
    color: #e2e8f0;
  }
  .markdown-content p {
    margin-bottom: 1em;
  }
  .markdown-content p:last-child {
    margin-bottom: 0;
  }
  .markdown-content ul, .markdown-content ol {
    margin-left: 1.5em;
    margin-bottom: 1em;
  }
  .markdown-content li {
    margin-bottom: 0.5em;
  }
  .markdown-content code {
    background-color: rgba(0, 0, 0, 0.3);
    padding: 0.2em 0.4em;
    border-radius: 0.25rem;
    font-size: 0.9em;
    font-family: 'Courier New', monospace;
  }
  .markdown-content pre {
    background-color: #1e293b;
    padding: 1em;
    border-radius: 0.5rem;
    overflow-x: auto;
    margin-bottom: 1em;
  }
  .markdown-content pre code {
    background-color: transparent;
    padding: 0;
    font-size: 0.85em;
  }
  .markdown-content h1, .markdown-content h2, .markdown-content h3,
  .markdown-content h4, .markdown-content h5, .markdown-content h6 {
    margin-top: 1.5em;
    margin-bottom: 0.5em;
    font-weight: 600;
    color: #cbd5f5;
  }
  .markdown-content h1 { font-size: 1.5em; }
  .markdown-content h2 { font-size: 1.3em; }
  .markdown-content h3 { font-size: 1.1em; }
  .markdown-content blockquote {
    border-left: 4px solid #3b82f6;
    padding-left: 1em;
    margin-left: 0;
    margin-bottom: 1em;
    color: #94a3b8;
  }
  .markdown-content a {
    color: #60a5fa;
    text-decoration: underline;
  }
  .markdown-content a:hover {
    color: #93c5fd;
  }
  .markdown-content table {
    border-collapse: collapse;
    width: 100%;
    margin-bottom: 1em;
  }
  .markdown-content th, .markdown-content td {
    border: 1px solid #475569;
    padding: 0.5em;
    text-align: left;
  }
  .markdown-content th {
    background-color: rgba(59, 130, 246, 0.2);
    font-weight: 600;
  }
  .markdown-content hr {
    border: none;
    border-top: 1px solid #475569;
    margin: 1.5em 0;
  }
`;

interface ChatMessageProps {
  role: MessageRole;
  content: string;
}

export function ChatMessage({ role, content }: ChatMessageProps) {
  const isUser = role === "user";
  const displayRole = isUser ? "You" : "Assistant";

  const backgroundColor = isUser ? "#0f172a" : "rgba(59, 130, 246, 0.18)";
  const borderColor = isUser ? "#1e293b" : "rgba(59, 130, 246, 0.4)";

  return (
    <>
      <style>{markdownStyles}</style>
      <article style={{ ...styles.card, backgroundColor, borderColor }}>
        <header style={styles.cardHeading}>{displayRole}</header>
        <div style={styles.cardBody} className="markdown-content">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeHighlight]}
          >
            {content}
          </ReactMarkdown>
        </div>
      </article>
    </>
  );
}
