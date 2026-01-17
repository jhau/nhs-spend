"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
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
  ExternalLink,
  Gauge,
} from "lucide-react";

interface SidebarItemProps {
  icon: React.ElementType;
  label: string;
  href: string;
  badge?: string;
  active?: boolean;
}

const SidebarItem = ({
  icon: Icon,
  label,
  href,
  badge,
  active,
}: SidebarItemProps) => (
  <Link
    href={href}
    className={`flex items-center justify-between px-4 py-2 text-sm font-medium transition-colors ${
      active
        ? "bg-white/10 text-white"
        : "text-slate-300 hover:bg-white/5 hover:text-white"
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
  const pathname = usePathname();

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  };

  return (
    <div className="flex h-screen w-64 flex-col bg-[#2D213F] text-white">
      {/* Logo */}
      <div className="flex items-center gap-2 px-6 py-8">
        <div className="flex h-8 w-8 items-center justify-center rounded bg-white p-1 text-[#2D213F] font-bold">
          A
        </div>
        <div className="flex flex-col">
          <span className="text-sm font-bold tracking-tight uppercase">
            ARCAMUS
          </span>
          <span className="text-[10px] font-medium tracking-[0.2em] text-slate-400 uppercase">
            Intelligence
          </span>
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
      <div className="flex-1 overflow-y-auto overflow-x-hidden [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
        <div className="flex flex-col gap-0.5">
          <SidebarItem
            icon={LayoutDashboard}
            label="Dashboard"
            href="/dashboard"
            active={isActive("/dashboard")}
          />
          <SidebarItem
            icon={LineChart}
            label="AI Market Intelligence"
            href="/assistant"
            active={isActive("/assistant")}
          />

          <SidebarSection title="Spend Data" />
          <SidebarItem
            icon={Users}
            label="Buyers"
            href="/buyers"
            active={isActive("/buyers")}
          />
          <SidebarItem
            icon={Users}
            label="Suppliers"
            href="/suppliers"
            active={isActive("/suppliers")}
          />
          <SidebarItem
            icon={Building2}
            label="Verified Entities"
            href="/entities"
            active={isActive("/entities")}
          />

          {/* <SidebarSection title="Discover" />
          <SidebarItem
            icon={Briefcase}
            label="Opportunities"
            href="/opportunities"
            badge="Enterprise"
            active={isActive("/opportunities")}
          />
          <SidebarItem
            icon={FileText}
            label="Contracts & Renewals"
            href="/contracts"
            active={isActive("/contracts")}
          />
          <SidebarItem
            icon={ClipboardList}
            label="Frameworks & Eligibility"
            href="/frameworks"
            active={isActive("/frameworks")}
          /> */}

          {/* <SidebarSection title="Organise" />
          <SidebarItem
            icon={Bookmark}
            label="Saved Lists"
            href="/saved-lists"
            active={isActive("/saved-lists")}
          />
          <SidebarItem
            icon={BarChart3}
            label="Reports"
            href="/reports"
            active={isActive("/reports")}
          />
          <SidebarItem
            icon={Users2}
            label="Team Directory"
            href="/team"
            active={isActive("/team")}
          /> */}
          <SidebarSection title="Admin" />
          <SidebarItem
            icon={RefreshCw}
            label="Import"
            href="/pipeline"
            active={isActive("/pipeline")}
          />
          <SidebarItem
            icon={Gauge}
            label="Data Dashboard"
            href="/admin/dashboard"
            active={isActive("/admin/dashboard")}
          />
          <SidebarItem
            icon={BarChart3}
            label="Usage Analytics"
            href="/admin/usage"
            active={isActive("/admin/usage")}
          />
          {/* <SidebarItem
            icon={Users2}
            label="User Management"
            href="/user-management"
            active={isActive("/user-management")}
          />
          <SidebarItem
            icon={Building}
            label="Organisational Profile"
            href="/profile"
            active={isActive("/profile")}
          />
          <SidebarItem
            icon={CreditCard}
            label="Billing & Subscription"
            href="/billing"
            active={isActive("/billing")}
          /> */}
        </div>
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
