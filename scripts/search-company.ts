import dotenv from "dotenv";
import readline from "readline";

// Load .env first, then .env.local overrides (if exists)
dotenv.config({ path: ".env" });
dotenv.config({ path: ".env.local", override: true });

const API_KEY = process.env.COMPANIES_HOUSE_API_KEY;
const BASE_URL = "https://api.company-information.service.gov.uk";

interface CompanySearchResult {
  company_number: string;
  title: string;
  company_status: string;
  company_type: string;
  date_of_creation?: string;
  address_snippet?: string;
  description?: string;
}

interface SearchResponse {
  items: CompanySearchResult[];
  total_results: number;
}

interface CompanyProfile {
  company_name: string;
  company_number: string;
  company_status: string;
  type: string;
  date_of_creation: string;
  registered_office_address: {
    address_line_1?: string;
    address_line_2?: string;
    locality?: string;
    postal_code?: string;
    country?: string;
  };
  sic_codes?: string[];
  accounts?: {
    next_due?: string;
    last_accounts?: {
      made_up_to?: string;
    };
  };
}

async function searchCompany(query: string): Promise<SearchResponse> {
  if (!API_KEY) {
    throw new Error("COMPANIES_HOUSE_API_KEY not set in environment");
  }

  const url = `${BASE_URL}/search/companies?q=${encodeURIComponent(
    query
  )}&items_per_page=10`;

  console.log(`API URL: ${url}\n`);

  const response = await fetch(url, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${API_KEY}:`).toString("base64")}`,
    },
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

async function getCompanyProfile(
  companyNumber: string
): Promise<CompanyProfile> {
  if (!API_KEY) {
    throw new Error("COMPANIES_HOUSE_API_KEY not set in environment");
  }

  const url = `${BASE_URL}/company/${companyNumber}`;

  console.log(`API URL: ${url}\n`);

  const response = await fetch(url, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${API_KEY}:`).toString("base64")}`,
    },
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function main() {
  const query = process.argv[2];

  if (!query) {
    console.log("Usage: tsx scripts/search-company.ts <company name>");
    console.log("Example: tsx scripts/search-company.ts 'Unilever'");
    process.exit(1);
  }

  console.log(`\nSearching for: "${query}"\n`);

  try {
    const results = await searchCompany(query);

    if (results.total_results === 0) {
      console.log("No companies found.");
      return;
    }

    console.log(`Found ${results.total_results} result(s):\n`);
    console.log("─".repeat(80));

    results.items.forEach((company, index) => {
      console.log(`\n  [${index + 1}] ${company.title}`);
      console.log(`      Company Number: ${company.company_number}`);
      console.log(`      Status: ${company.company_status}`);
      console.log(`      Type: ${company.company_type}`);
      if (company.date_of_creation) {
        console.log(`      Created: ${company.date_of_creation}`);
      }
      if (company.address_snippet) {
        console.log(`      Address: ${company.address_snippet}`);
      }
    });

    console.log("\n" + "─".repeat(80));

    const answer = await prompt(
      `\nSelect company (1-${results.items.length}) or press Enter to skip: `
    );

    if (!answer) {
      console.log("Skipped.");
      return;
    }

    const selection = parseInt(answer, 10);

    if (isNaN(selection) || selection < 1 || selection > results.items.length) {
      console.log("Invalid selection.");
      return;
    }

    const selectedCompany = results.items[selection - 1];
    console.log(`\nFetching full details for: ${selectedCompany.title}\n`);

    const profile = await getCompanyProfile(selectedCompany.company_number);
    console.log(JSON.stringify(profile, null, 2));
  } catch (error) {
    console.error("Error:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
