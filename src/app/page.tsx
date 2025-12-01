"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { ChatMessage } from "./components/ChatMessage.js";
import { ToolCallMessage } from "./components/ToolCallMessage.js";
import { ToolResultMessage } from "./components/ToolResultMessage.js";
import { EmptyState } from "./components/EmptyState.js";

type MessageRole = "user" | "assistant" | "tool" | "system";

interface MessagePart {
  type: "text" | "tool-call" | "tool-result";
  content?: string;
  toolName?: string;
  args?: any;
  result?: any;
  toolCallId?: string;
}

interface Message {
  id: string;
  role: MessageRole;
  content?: string;
  parts?: MessagePart[];
}

const styles = {
  page: {
    minHeight: "100vh",
    display: "flex",
    flexDirection: "column" as const,
    backgroundColor: "#0f172a",
    color: "#e2e8f0",
    fontFamily:
      "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
  header: {
    borderBottom: "1px solid #1e293b",
    backgroundColor: "rgba(15, 23, 42, 0.9)",
    padding: "1.5rem 2rem",
  },
  headerTitle: { fontSize: "1.75rem", fontWeight: 600 },
  headerSubtitle: {
    marginTop: "0.5rem",
    maxWidth: "52rem",
    fontSize: "0.95rem",
    color: "#cbd5f5",
  },
  content: {
    flex: 1,
    display: "flex",
    flexDirection: "column" as const,
    gap: "1.5rem",
    padding: "1.5rem 2rem 2.5rem",
  },
  messages: {
    flex: 1,
    overflowY: "auto" as const,
    borderRadius: "0.75rem",
    border: "1px solid #1e293b",
    backgroundColor: "#111e36",
    padding: "1.25rem",
    boxShadow: "inset 0 1px 2px rgba(15, 23, 42, 0.45)",
  },
  form: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "0.75rem",
  },
  textarea: {
    minHeight: "90px",
    resize: "vertical" as const,
    borderRadius: "0.75rem",
    border: "1px solid #334155",
    backgroundColor: "#0f172a",
    padding: "0.9rem 1rem",
    fontSize: "1rem",
    color: "inherit",
  },
  formFooter: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    fontSize: "0.85rem",
    color: "#94a3b8",
  },
  buttonGroup: {
    display: "flex",
    gap: "0.5rem",
  },
  button: {
    borderRadius: "0.5rem",
    border: "none",
    padding: "0.6rem 1.1rem",
    fontSize: "0.9rem",
    fontWeight: 600,
    cursor: "pointer",
  },
  primaryButton: {
    backgroundColor: "#3b82f6",
    color: "white",
  },
  stopButton: {
    backgroundColor: "#1f2937",
    color: "#f8fafc",
  },
  error: { color: "#f87171", fontSize: "0.9rem" },
  messageList: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "1rem",
  },
};

export default function HomePage() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const listRef = useRef<HTMLDivElement>(null);

  // Log component initialization
  useEffect(() => {
    console.log("[HomePage] Component mounted");
    return () => {
      console.log("[HomePage] Component unmounting");
    };
  }, []);

  // Log messages array changes
  useEffect(() => {
    console.log("[HomePage] Messages array changed:", {
      messageCount: messages.length,
      messages: messages.map((msg) => ({
        id: msg.id,
        role: msg.role,
        contentLength: msg.content?.length ?? 0,
        partsCount: msg.parts?.length ?? 0,
      })),
      timestamp: new Date().toISOString(),
    });
  }, [messages]);

  // Log error changes
  useEffect(() => {
    if (error) {
      console.error("[HomePage] Error occurred:", {
        error,
        message: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString(),
      });
    }
  }, [error]);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages]);

  const sendMessage = async (messageContent: string) => {
    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: "user",
      content: messageContent,
    };

    // Add user message to the list
    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);
    setError(null);

    try {
      console.log("[HomePage] Sending request to API:", {
        message: messageContent,
        timestamp: new Date().toISOString(),
      });

      // Prepare messages in the format expected by the backend
      const requestMessages = [...messages, userMessage].map((msg) => ({
        role:
          msg.role === "assistant"
            ? "assistant"
            : msg.role === "user"
            ? "user"
            : "system",
        content: msg.content,
      }));

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: requestMessages,
        }),
      });

      console.log("[HomePage] Response received:", {
        status: response.status,
        statusText: response.statusText,
        timestamp: new Date().toISOString(),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to get response");
      }

      const data = await response.json();
      console.log("[HomePage] Response data:", {
        data,
        timestamp: new Date().toISOString(),
      });

      // Add assistant message to the list
      const assistantMessage: Message = {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        parts: data.parts || [],
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (err) {
      console.error("[HomePage] Error sending message:", err);
      const errorObj = err instanceof Error ? err : new Error(String(err));
      setError(errorObj);
    } finally {
      setIsLoading(false);
    }
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    console.log("[HomePage] Form submitted:", {
      input,
      inputLength: input.length,
      inputTrimmed: input.trim(),
      timestamp: new Date().toISOString(),
    });
    if (input.trim()) {
      const messageContent = input.trim();
      console.log("[HomePage] Sending message:", {
        message: messageContent,
        timestamp: new Date().toISOString(),
      });
      sendMessage(messageContent);
      setInput("");
      console.log("[HomePage] Input cleared after send");
    } else {
      console.warn("[HomePage] Form submitted with empty/whitespace input");
    }
  };

  return (
    <main style={styles.page}>
      <header style={styles.header}>
        <h1 style={styles.headerTitle}>NHS Spend Explorer Chat</h1>
        <p style={styles.headerSubtitle}>
          Ask questions about the imported NHS spending data. The assistant can
          run read-only SQL queries against the database when it needs exact
          figures.
        </p>
      </header>

      <section style={styles.content}>
        <div ref={listRef} style={styles.messages}>
          {messages.length === 0 ? (
            <EmptyState />
          ) : (
            <div style={styles.messageList}>
              {messages.map((message) => {
                // If message has parts, render each part
                if (message.parts && message.parts.length > 0) {
                  return (
                    <div key={message.id}>
                      {message.parts.map((part, index) => {
                        if (part.type === "text") {
                          return (
                            <ChatMessage
                              key={`${message.id}-${index}`}
                              role={message.role}
                              content={part.content || ""}
                            />
                          );
                        } else if (part.type === "tool-call") {
                          return (
                            <ToolCallMessage
                              key={`${message.id}-${index}`}
                              toolName={part.toolName || "unknown"}
                              args={part.args}
                            />
                          );
                        } else if (part.type === "tool-result") {
                          return (
                            <ToolResultMessage
                              key={`${message.id}-${index}`}
                              toolName={part.toolName || "unknown"}
                              result={part.result}
                            />
                          );
                        }
                        return null;
                      })}
                    </div>
                  );
                }
                // Otherwise, render simple content
                return (
                  <ChatMessage
                    key={message.id}
                    role={message.role}
                    content={message.content || ""}
                  />
                );
              })}
            </div>
          )}
        </div>

        <form onSubmit={onSubmit} style={styles.form}>
          <textarea
            style={styles.textarea}
            placeholder="Example: Total spending by Alder Hey Children's NHS Foundation Trust in 2022"
            value={input}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => {
              const newValue = e.target.value;
              console.log("[HomePage] Input changed:", {
                newValue,
                length: newValue.length,
                timestamp: new Date().toISOString(),
              });
              setInput(newValue);
            }}
            disabled={isLoading}
            required
          />

          <div style={styles.formFooter}>
            <span>
              Set <code>OPENAI_API_KEY</code> in your environment to enable the
              model. Queries are read-only.
            </span>

            <div style={styles.buttonGroup}>
              <button
                type="submit"
                style={{
                  ...styles.button,
                  ...styles.primaryButton,
                  opacity: isLoading ? 0.6 : 1,
                }}
                disabled={isLoading}
              >
                {isLoading ? "Sending..." : "Send"}
              </button>
            </div>
          </div>

          {error && (
            <p style={styles.error}>
              {error.message ?? "Something went wrong. Please try again."}
            </p>
          )}
        </form>
      </section>
    </main>
  );
}
