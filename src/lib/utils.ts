import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Get default date range (previous year)
export function getDefaultDateRange() {
  const currentYear = new Date().getFullYear();
  const previousYear = currentYear - 1;
  return {
    startDate: `${previousYear}-01-01`,
    endDate: `${previousYear}-12-31`,
  };
}

