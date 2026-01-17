"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { TextStreamChatTransport } from "ai";
import {
  Send,
  StopCircle,
  Plus,
  MessageSquare,
  ChevronDown,
  Cpu,
  Trash2,
  Clock,
} from "lucide-react";

import { ChatMessage } from "../components/ChatMessage";
import { EmptyState } from "../components/EmptyState";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const MODELS = [
  { id: "google/gemini-3-pro-preview", name: "Gemini 3 Pro" },
  { id: "openai/gpt-5.2", name: "ChatGPT 5.2" },
];

type Conversation = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export default function AssistantPage() {
  const listRef = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState("");
  const [selectedModel, setSelectedModel] = useState(MODELS[0]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [loadingConversations, setLoadingConversations] = useState(false);

  // Custom transport that includes conversationId
  const transport = useRef(
    new TextStreamChatTransport({ api: "/api/assistant" })
  );

  const { messages, sendMessage, status, error, stop, setMessages } = useChat({
    transport: transport.current,
  });

  const isLoading = status === "submitted" || status === "streaming";

  // Fetch conversations list
  const fetchConversations = useCallback(async () => {
    setLoadingConversations(true);
    try {
      const res = await fetch("/api/conversations?limit=20");
      if (res.ok) {
        const data = await res.json();
        setConversations(data.conversations || []);
      }
    } catch (e) {
      console.error("Failed to fetch conversations:", e);
    } finally {
      setLoadingConversations(false);
    }
  }, []);

  // Load a specific conversation
  const loadConversation = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/conversations/${id}`);
        if (res.ok) {
          const data = await res.json();
          setConversationId(id);

          // Convert messages to UI format
          const uiMessages = (data.messages || []).map(
            (m: { role: string; content: string }, idx: number) => ({
              id: `${id}-${idx}`,
              role: m.role,
              parts: [{ type: "text", text: m.content }],
            })
          );

          setMessages(uiMessages);
          setShowHistory(false);
        }
      } catch (e) {
        console.error("Failed to load conversation:", e);
      }
    },
    [setMessages]
  );

  // Delete a conversation
  const deleteConversation = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const res = await fetch(`/api/conversations/${id}`, { method: "DELETE" });
      if (res.ok) {
        setConversations((prev) => prev.filter((c) => c.id !== id));
        if (conversationId === id) {
          startNewConversation();
        }
      }
    } catch (e) {
      console.error("Failed to delete conversation:", e);
    }
  };

  // Start a new conversation
  const startNewConversation = () => {
    setConversationId(null);
    setMessages([]);
    setShowHistory(false);
  };

  // Fetch conversations on mount
  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  // Extract conversationId from metadata and update state
  useEffect(() => {
    if (messages.length > 0) {
      const lastMsg = messages[messages.length - 1];
      if (lastMsg.role === "assistant") {
        const rawContent = lastMsg.parts
          .filter((p) => p.type === "text" || p.type === "reasoning")
          .map((p: any) => p.text)
          .join("");

        const metadataMatch = rawContent.match(/\n\n\[METADATA:(.*)\]$/);
        if (metadataMatch) {
          try {
            const metadata = JSON.parse(metadataMatch[1]);
            if (metadata.conversationId && !conversationId) {
              setConversationId(metadata.conversationId);
              // Refresh conversations list to show the new one
              fetchConversations();
            }
          } catch (e) {
            // Ignore parse errors
          }
        }
      }
    }
  }, [messages, conversationId, fetchConversations]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    setInput("");
    await sendMessage({
      text,
      metadata: { model: selectedModel.id },
      data: { model: selectedModel.id, conversationId },
    } as any);
  };

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  return (
    <div className="flex h-full bg-slate-50 overflow-hidden font-sans">
      {/* Conversation History Sidebar */}
      <div
        className={`${
          showHistory ? "w-72" : "w-0"
        } transition-all duration-200 bg-white border-r border-slate-200 flex flex-col overflow-hidden`}
      >
        <div className="p-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-700">History</h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={startNewConversation}
            className="h-8 w-8 p-0"
          >
            <Plus size={16} />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loadingConversations ? (
            <div className="p-4 text-center text-sm text-slate-400">
              Loading...
            </div>
          ) : conversations.length === 0 ? (
            <div className="p-4 text-center text-sm text-slate-400">
              No conversations yet
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {conversations.map((conv) => (
                <div
                  key={conv.id}
                  onClick={() => loadConversation(conv.id)}
                  className={`p-3 cursor-pointer hover:bg-slate-50 transition-colors group ${
                    conversationId === conv.id ? "bg-slate-100" : ""
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-700 truncate">
                        {conv.title || "Untitled"}
                      </p>
                      <p className="text-xs text-slate-400 flex items-center gap-1 mt-0.5">
                        <Clock size={10} />
                        {formatDate(conv.updatedAt)}
                      </p>
                    </div>
                    <button
                      onClick={(e) => deleteConversation(conv.id, e)}
                      className="opacity-0 group-hover:opacity-100 p-1 hover:bg-slate-200 rounded transition-all"
                    >
                      <Trash2 size={14} className="text-slate-400" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="h-12 border-b border-slate-200 bg-white flex items-center px-4 gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowHistory(!showHistory)}
            className="h-8 w-8 p-0"
          >
            <MessageSquare size={18} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={startNewConversation}
            className="h-8 gap-1.5 text-xs"
          >
            <Plus size={14} />
            New Chat
          </Button>
          {conversationId && (
            <span className="text-xs text-slate-400 ml-auto">
              {conversations.find((c) => c.id === conversationId)?.title ||
                "Current conversation"}
            </span>
          )}
        </div>

        <section className="flex-1 flex flex-col gap-4 p-6 overflow-hidden min-h-0">
          <div
            ref={listRef}
            className="flex-1 overflow-y-auto rounded-xl border border-slate-200 bg-white p-6 shadow-sm min-h-0 scroll-smooth"
          >
            {messages.length === 0 ? (
              <EmptyState />
            ) : (
              <div className="flex flex-col gap-5">
                {messages
                  .filter((m) => m.role === "user" || m.role === "assistant")
                  .map((m, idx, filtered) => {
                    const rawContent = m.parts
                      .filter(
                        (p) => p.type === "text" || p.type === "reasoning"
                      )
                      .map((p: any) => p.text)
                      .join("");

                    // Extract metadata if present
                    let displayContent = rawContent;
                    let metadata = undefined;
                    const metadataMatch = rawContent.match(
                      /\n\n\[METADATA:(.*)\]$/
                    );
                    if (metadataMatch) {
                      try {
                        metadata = JSON.parse(metadataMatch[1]);
                        displayContent = rawContent.replace(
                          /\n\n\[METADATA:.*\]$/,
                          ""
                        );
                      } catch (e) {
                        console.error("Failed to parse metadata", e);
                      }
                    }

                    const isLast = idx === filtered.length - 1;
                    const isAssistantStreamingAndEmpty =
                      isLast &&
                      status === "streaming" &&
                      displayContent.trim() === "" &&
                      m.role === "assistant";

                    return (
                      <ChatMessage
                        key={m.id}
                        role={m.role as any}
                        content={displayContent}
                        metadata={metadata}
                        isLoading={isAssistantStreamingAndEmpty}
                      />
                    );
                  })}
                {status === "submitted" && (
                  <ChatMessage role="assistant" content="" isLoading={true} />
                )}
              </div>
            )}
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                  <Cpu size={12} />
                  Model:
                </span>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600 hover:text-slate-900 transition-colors bg-slate-100/50 px-2 py-1 rounded-md border border-slate-200"
                    >
                      {selectedModel.name}
                      <ChevronDown size={12} className="opacity-50" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-56">
                    {MODELS.map((model) => (
                      <DropdownMenuItem
                        key={model.id}
                        onClick={() => setSelectedModel(model)}
                        className="text-xs font-medium cursor-pointer"
                      >
                        {model.name}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              {isLoading && (
                <div className="flex items-center gap-2">
                  <div className="flex gap-1">
                    <span
                      className="w-1 h-1 bg-slate-400 rounded-full animate-bounce"
                      style={{ animationDelay: "0ms" }}
                    />
                    <span
                      className="w-1 h-1 bg-slate-400 rounded-full animate-bounce"
                      style={{ animationDelay: "150ms" }}
                    />
                    <span
                      className="w-1 h-1 bg-slate-400 rounded-full animate-bounce"
                      style={{ animationDelay: "300ms" }}
                    />
                  </div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Assistant is processing
                  </span>
                </div>
              )}
            </div>

            <div className="flex gap-3 items-end">
              <textarea
                className="flex-1 min-h-[44px] h-[44px] max-h-[200px] resize-none rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm ring-offset-white placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 shadow-sm transition-all"
                placeholder="Example: Top 10 suppliers by spend for NHS Mid and South Essex ICB in 2024"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                disabled={isLoading}
                required
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSubmit(e as any);
                  }
                }}
              />
              <Button
                type={isLoading ? "button" : "submit"}
                className="h-11 px-6 bg-[#2D213F] hover:bg-[#3d2d55] text-white shadow-sm transition-all shrink-0 rounded-xl"
                onClick={isLoading ? () => void stop() : undefined}
              >
                {isLoading ? (
                  <>
                    <StopCircle className="mr-2 h-4 w-4" />
                    Stop
                  </>
                ) : (
                  <>
                    <Send className="mr-2 h-4 w-4" />
                    Send
                  </>
                )}
              </Button>
            </div>

            {error && (
              <p className="text-destructive text-xs font-medium px-1">
                {error instanceof Error
                  ? error.message
                  : "Something went wrong. Please try again."}
              </p>
            )}
          </form>
        </section>
      </div>
    </div>
  );
}
