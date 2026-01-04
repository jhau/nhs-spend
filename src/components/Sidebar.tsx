"use client";

import React from 'react';
import Link from 'next/link';
import { 
  LayoutDashboard, 
  LineChart, 
  Sparkles, 
  Building2, 
  Users, 
  Briefcase, 
  FileText, 
  ClipboardList, 
  Bookmark, 
  BarChart3, 
  RefreshCw, 
  Link2, 
  Users2, 
  Building, 
  CreditCard,
  HelpCircle,
  ExternalLink
} from 'lucide-react';

interface SidebarItemProps {
  icon: React.ElementType;
  label: string;
  href: string;
  badge?: string;
  active?: boolean;
}

const SidebarItem = ({ icon: Icon, label, href, badge, active }: SidebarItemProps) => (
  <Link 
    href={href}
    className={`flex items-center justify-between px-4 py-2 text-sm font-medium transition-colors ${
      active ? 'bg-white/10 text-white' : 'text-slate-300 hover:bg-white/5 hover:text-white'
    }`}
  >
    <div className="flex items-center gap-3">
      <Icon className="h-4 w-4" />
      <span>{label}</span>
    </div>
    {badge && (
      <span className="rounded bg-orange-500/20 px-1.5 py-0.5 text-[10px] font-bold text-orange-500 uppercase">
        {badge}
      </span>
    )}
  </Link>
);

const SidebarSection = ({ title }: { title: string }) => (
  <div className="px-4 py-3 text-[10px] font-bold tracking-wider text-slate-500 uppercase">
    {title}
  </div>
);

export const Sidebar = () => {
  return (
    <div className="flex h-screen w-64 flex-col bg-[#2D213F] text-white">
      {/* Logo */}
      <div className="flex items-center gap-2 px-6 py-8">
        <div className="flex h-8 w-8 items-center justify-center rounded bg-white p-1">
          <img src="/logo-small.svg" alt="Arcamus" className="h-full w-full" onError={(e) => (e.currentTarget.style.display = 'none')} />
          <div className="font-bold text-[#2D213F]">A</div>
        </div>
        <div className="flex flex-col">
          <span className="text-sm font-bold tracking-tight uppercase">ARCAMUS</span>
          <span className="text-[10px] font-medium tracking-[0.2em] text-slate-400 uppercase">Intelligence</span>
        </div>
      </div>

      {/* Get Started Button */}
      <div className="px-4 mb-6">
        <button className="flex w-full items-center justify-center gap-2 rounded-md border border-white/20 px-4 py-2 text-sm font-medium hover:bg-white/10">
          <Sparkles className="h-4 w-4" />
          Get Started
        </button>
      </div>

      {/* Navigation */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin scrollbar-thumb-white/10">
        <div className="flex flex-col gap-0.5">
          <SidebarItem icon={LayoutDashboard} label="Dashboard" href="/dashboard" />
          <SidebarItem icon={LineChart} label="Market Intelligence" href="/market-intelligence" />
          <SidebarItem icon={Sparkles} label="AI Recommendations" href="/ai-recommendations" />

          <SidebarSection title="Spend Data" />
          <SidebarItem icon={Building2} label="Companies" href="/companies" />
          <SidebarItem icon={Users} label="Buyers" href="/buyers" active />

          <SidebarSection title="Discover" />
          <SidebarItem icon={Briefcase} label="Opportunities" href="/opportunities" badge="Enterprise" />
          <SidebarItem icon={FileText} label="Contracts & Renewals" href="/contracts" />
          <SidebarItem icon={ClipboardList} label="Frameworks & Eligibility" href="/frameworks" />

          <SidebarSection title="Organise" />
          <SidebarItem icon={Bookmark} label="Saved Lists" href="/saved-lists" />
          <SidebarItem icon={BarChart3} label="Reports" href="/reports" />
          <SidebarItem icon={Users2} label="Team Directory" href="/team" />
          <SidebarItem icon={RefreshCw} label="Pipeline Sync" href="/pipeline" badge="Enterprise" />

          <SidebarSection title="Admin" />
          <SidebarItem icon={Link2} label="Integrations" href="/integrations" />
          <SidebarItem icon={Users2} label="User Management" href="/user-management" />
          <SidebarItem icon={Building} label="Organisational Profile" href="/profile" />
          <SidebarItem icon={CreditCard} label="Billing & Subscription" href="/billing" />
        </div>

        {/* Bid Management Platform Card */}
        <div className="m-4 rounded-lg bg-white/5 p-4">
          <div className="mb-2 flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded bg-white p-0.5">
              <span className="text-[10px] font-bold text-[#2D213F]">A</span>
            </div>
            <span className="text-[10px] font-bold uppercase tracking-tight">Bid Management</span>
          </div>
          <p className="mb-3 text-[10px] text-slate-300 leading-relaxed">
            Manage the entire bid management process with AI assisted workflows
          </p>
          <button className="flex w-full items-center justify-center gap-2 rounded bg-orange-500 px-3 py-1.5 text-[10px] font-bold hover:bg-orange-600 transition-colors">
            Get Intelligent
            <ExternalLink className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* Footer Buttons */}
      <div className="flex border-t border-white/10">
        <button className="flex flex-1 items-center justify-center gap-2 py-4 text-[11px] font-medium text-slate-300 hover:bg-white/5 hover:text-white">
          <HelpCircle className="h-4 w-4" />
          Get Help
        </button>
        <div className="w-px bg-white/10" />
        <button className="flex flex-1 items-center justify-center gap-2 py-4 text-[11px] font-medium text-slate-300 hover:bg-white/5 hover:text-white">
          <FileText className="h-4 w-4" />
          Documentation
        </button>
      </div>

      {/* User Profile */}
      <div className="border-t border-white/10 p-4">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 overflow-hidden rounded-full bg-orange-500 flex items-center justify-center font-bold">
            HP
          </div>
          <div className="flex flex-col overflow-hidden">
            <span className="text-sm font-bold truncate">Harry Potter</span>
            <span className="text-[10px] text-slate-400">Admin</span>
          </div>
        </div>
      </div>
    </div>
  );
};

