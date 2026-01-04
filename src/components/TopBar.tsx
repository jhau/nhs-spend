"use client";

import React from 'react';
import { Search, Bell, HelpCircle, Menu } from 'lucide-react';

export const TopBar = () => {
  return (
    <div className="flex h-16 items-center justify-between border-b border-slate-200 bg-white px-8">
      {/* Search Bar */}
      <div className="flex flex-1 items-center justify-center">
        <div className="relative w-full max-w-2xl">
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
            <Search className="h-4 w-4 text-slate-400" />
          </div>
          <input
            type="text"
            className="block w-full rounded-md border-0 py-2 pl-10 pr-3 text-sm text-slate-900 ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:leading-6"
            placeholder="Search for anything on the platform..."
          />
        </div>
      </div>

      {/* Action Icons */}
      <div className="flex items-center gap-3">
        <button className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200">
          <Bell className="h-5 w-5" />
        </button>
        <button className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200">
          <HelpCircle className="h-5 w-5" />
        </button>
        <button className="flex h-10 w-10 items-center justify-center rounded-full bg-[#4A4159] text-white hover:bg-[#3D354A]">
          <Menu className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
};

