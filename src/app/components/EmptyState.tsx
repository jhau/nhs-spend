import { Sparkles } from "lucide-react";

export function EmptyState() {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-6 text-center py-12 px-6">
      <div className="w-16 h-16 rounded-2xl bg-slate-50 flex items-center justify-center shadow-inner border border-slate-100">
        <Sparkles className="w-8 h-8 text-[#2D213F] opacity-50" />
      </div>
      <div className="space-y-2">
        <h2 className="text-xl font-semibold text-slate-900">Start exploring the data</h2>
        <p className="max-w-md text-sm text-slate-500 leading-relaxed mx-auto">
          Ask domain questions such as "Which suppliers received the most in
          2023?" or "How many payments were recorded for Manchester University NHS
          Foundation Trust in March 2022?".
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-w-lg w-full">
        {[
          "Top 10 suppliers by spend in 2024",
          "Regional spend breakdown for ICBs",
          "Identify duplicate payments",
          "Analyze supplier market share"
        ].map((example) => (
          <div key={example} className="text-[11px] font-medium text-slate-600 bg-slate-50 border border-slate-100 rounded-lg py-2 px-3 shadow-sm hover:bg-slate-100 cursor-pointer transition-colors">
            {example}
          </div>
        ))}
      </div>
    </div>
  );
}


