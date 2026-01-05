import stringSimilarity from "string-similarity";

const BASE_URL = "https://api.company-information.service.gov.uk";
export const RATE_LIMIT_MS = parseInt(process.env.COMPANIES_HOUSE_RATE_LIMIT_MS || "600", 10);

let lastRequestTime = 0;

export async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function rateLimitedFetch(url: string, apiKey: string): Promise<Response> {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  
  if (timeSinceLastRequest < RATE_LIMIT_MS) {
    await sleep(RATE_LIMIT_MS - timeSinceLastRequest);
  }
  
  lastRequestTime = Date.now();
  
  return fetch(url, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`,
    },
  });
}

export function normalizeCompanyName(name: string): string {
  return name
    .toUpperCase()
    .replace(/\bLIMITED\b/g, "LTD")
    .replace(/\bPUBLIC LIMITED COMPANY\b/g, "PLC")
    .replace(/[^A-Z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function calculateSimilarity(supplierName: string, companyName: string): number {
  const normalizedSupplier = normalizeCompanyName(supplierName);
  const normalizedCompany = normalizeCompanyName(companyName);
  return stringSimilarity.compareTwoStrings(normalizedSupplier, normalizedCompany);
}

export interface CompanySearchResult {
  company_number: string;
  title: string;
  company_status: string;
  company_type: string;
  date_of_creation?: string;
  address_snippet?: string;
}

export interface SearchResponse {
  items?: CompanySearchResult[];
  total_results: number;
}

export interface CompanyProfile {
  company_name: string;
  company_number: string;
  company_status: string;
  type: string;
  date_of_creation?: string;
  jurisdiction?: string;
  registered_office_address?: {
    address_line_1?: string;
    address_line_2?: string;
    locality?: string;
    postal_code?: string;
    country?: string;
  };
  sic_codes?: string[];
  previous_names?: { name: string; effective_from: string; ceased_on: string }[];
  etag?: string;
}

export async function searchCompanies(query: string, apiKey: string): Promise<SearchResponse> {
  const url = `${BASE_URL}/search/companies?q=${encodeURIComponent(query)}&items_per_page=5`;
  const response = await rateLimitedFetch(url, apiKey);
  
  if (!response.ok) {
    throw new Error(`Companies House Search API error: ${response.status} ${response.statusText}`);
  }
  
  return response.json();
}

export async function getCompanyProfile(companyNumber: string, apiKey: string): Promise<CompanyProfile> {
  const url = `${BASE_URL}/company/${companyNumber}`;
  const response = await rateLimitedFetch(url, apiKey);
  
  if (!response.ok) {
    throw new Error(`Companies House Profile API error: ${response.status} ${response.statusText}`);
  }
  
  return response.json();
}

