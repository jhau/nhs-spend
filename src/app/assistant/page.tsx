"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { TextStreamChatTransport } from "ai";
import { Send, StopCircle } from "lucide-react";

import { ChatMessage } from "../components/ChatMessage";
import { EmptyState } from "../components/EmptyState";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown, Cpu } from "lucide-react";

const MODELS = [{ id: "google/gemini-3-pro-preview", name: "Gemini 3 Pro" }];

export default function AssistantPage() {
  const listRef = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState("");
  const [selectedModel, setSelectedModel] = useState(MODELS[0]);

  const { messages, sendMessage, status, error, stop } = useChat({
    transport: new TextStreamChatTransport({ api: "/api/assistant" }),
  });

  const isLoading = status === "submitted" || status === "streaming";

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    setInput("");
    await sendMessage({ text, metadata: { model: selectedModel.id } });
  };

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages]);

  return (
    <div className="flex flex-col h-full bg-slate-50 overflow-hidden font-sans">
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
                .map((m) => (
                  <ChatMessage
                    key={m.id}
                    role={m.role as any}
                    content={m.parts
                      .filter(
                        (p) => p.type === "text" || p.type === "reasoning"
                      )
                      .map((p: any) => p.text)
                      .join("")}
                  />
                ))}
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
  );
}
