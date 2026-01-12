"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github.css";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { User, Bot } from "lucide-react";
import { cn } from "@/lib/utils";

type MessageRole = "user" | "assistant" | "tool" | "system";

interface ChatMessageProps {
  role: MessageRole;
  content: string;
  isLoading?: boolean;
  metadata?: {
    totalTimeMs?: number;
    dbTimeMs?: number;
  };
}

export function ChatMessage({ role, content, isLoading, metadata }: ChatMessageProps) {
  const isUser = role === "user";

  return (
    <Card className={cn(
      "overflow-hidden transition-all shadow-sm border-slate-200",
      isUser ? "bg-slate-50/50" : "bg-white"
    )}>
      <CardHeader className="py-2.5 px-4 flex flex-row items-center gap-3 border-b border-slate-100 bg-slate-50/30">
        <div className={cn(
          "w-6 h-6 rounded-md flex items-center justify-center shadow-sm",
          isUser ? "bg-[#2D213F] text-white" : "bg-orange-500 text-white"
        )}>
          {isUser ? <User size={12} /> : <Bot size={12} />}
        </div>
        <CardTitle className="text-[10px] font-bold uppercase tracking-wider text-slate-500 m-0">
          {isUser ? "You" : "Assistant"}
        </CardTitle>
      </CardHeader>
      <CardContent className="py-3 px-5">
        <div className="text-sm text-slate-700 leading-relaxed overflow-x-auto">
          {isLoading ? (
            <div className="flex gap-1 py-1">
              <span
                className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce"
                style={{ animationDelay: "0ms" }}
              />
              <span
                className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce"
                style={{ animationDelay: "150ms" }}
              />
              <span
                className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce"
                style={{ animationDelay: "300ms" }}
              />
            </div>
          ) : (
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeHighlight]}
              components={{
                p: ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
                ul: ({ children }) => <ul className="list-disc ml-5 mb-3 space-y-1">{children}</ul>,
                ol: ({ children }) => <ol className="list-decimal ml-5 mb-3 space-y-1">{children}</ol>,
                li: ({ children }) => <li className="pl-1">{children}</li>,
                h1: ({ children }) => <h1 className="text-lg font-bold mt-4 mb-2 text-slate-900">{children}</h1>,
                h2: ({ children }) => <h2 className="text-base font-bold mt-3 mb-2 text-slate-900">{children}</h2>,
                h3: ({ children }) => <h3 className="text-sm font-bold mt-2 mb-1 text-slate-900">{children}</h3>,
                code: ({ children }) => (
                  <code className="bg-slate-100 text-rose-600 px-1 py-0.5 rounded font-mono text-[0.85em]">
                    {children}
                  </code>
                ),
                pre: ({ children }) => (
                  <pre className="bg-slate-900 text-slate-100 p-4 rounded-xl overflow-x-auto mb-3 border border-slate-800 shadow-inner">
                    {children}
                  </pre>
                ),
                table: ({ children }) => (
                  <div className="overflow-x-auto mb-4 border rounded-lg">
                    <table className="min-w-full divide-y divide-slate-200">{children}</table>
                  </div>
                ),
                thead: ({ children }) => <thead className="bg-slate-50">{children}</thead>,
                th: ({ children }) => <th className="px-3 py-2 text-left text-[11px] font-bold text-slate-500 uppercase tracking-wider border-b">{children}</th>,
                td: ({ children }) => <td className="px-3 py-2 text-xs text-slate-600 border-b">{children}</td>,
                blockquote: ({ children }) => <blockquote className="border-l-4 border-slate-200 pl-4 italic my-3 text-slate-500">{children}</blockquote>,
                a: ({ children, href }) => <a href={href} className="text-blue-600 underline hover:text-blue-800" target="_blank" rel="noopener noreferrer">{children}</a>,
              }}
            >
              {content}
            </ReactMarkdown>
          )}
        </div>
        
        {metadata && (
          <div className="mt-4 pt-3 border-t border-slate-100 flex gap-4 text-[10px] font-medium text-slate-400">
            {metadata.totalTimeMs !== undefined && (
              <span>Total: {(metadata.totalTimeMs / 1000).toFixed(1)}s</span>
            )}
            {metadata.dbTimeMs !== undefined && (
              <span>DB: {(metadata.dbTimeMs / 1000).toFixed(1)}s</span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}


