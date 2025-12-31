import { db } from "@/db";
import { contracts, contractSupplierSearches } from "@/db/schema";
import { sql, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import stringSimilarity from "string-similarity";

interface ContractsFinderSearchResult {
  item: {
    id: string;
    title: string;
    description: string;
    organisationName: string;
    publishedDate: string;
    awardedDate: string;
    awardedValue: number | null;
    awardedSupplier: string | null; // Comma-separated list of suppliers
    cpvDescription: string | null;
    region: string | null;
  };
}

async function searchContractsFromAPI(keyword: string, size: number = 100) {
  const searchPayload = {
    searchCriteria: {
      keyword,
      statuses: ["Awarded"],
      types: ["Contract"],
    },
    size,
  };

  const apiUrl =
    "https://www.contractsfinder.service.gov.uk/api/rest/2/search_notices/json";
  const startTime = Date.now();

  console.log("[Contracts Finder API] Starting API request", {
    keyword,
    size,
    url: apiUrl,
    payload: searchPayload,
    timestamp: new Date().toISOString(),
  });

  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(searchPayload),
    });

    const duration = Date.now() - startTime;

    if (!response.ok) {
      const errorText = await response
        .text()
        .catch(() => "Unable to read error response");
      console.error("[Contracts Finder API] API request failed", {
        keyword,
        status: response.status,
        statusText: response.statusText,
        duration: `${duration}ms`,
        errorBody: errorText.substring(0, 500), // Limit error body length
        timestamp: new Date().toISOString(),
      });
      return { noticeList: [], hitCount: 0 };
    }

    const data = await response.json();
    const hitCount = data.hitCount || 0;
    const noticeCount = data.noticeList?.length || 0;

    console.log("[Contracts Finder API] API request successful", {
      keyword,
      status: response.status,
      duration: `${duration}ms`,
      hitCount,
      noticeCount,
      timestamp: new Date().toISOString(),
    });

    return data;
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error("[Contracts Finder API] API request exception", {
      keyword,
      error: error instanceof Error ? error.message : String(error),
      errorStack: error instanceof Error ? error.stack : undefined,
      duration: `${duration}ms`,
      timestamp: new Date().toISOString(),
    });
    return { noticeList: [], hitCount: 0 };
  }
}

async function getCachedContracts(searchKeyword: string) {
  // Get all contracts linked to this search keyword
  const cachedContracts = await db
    .select({
      id: contracts.id,
      contractId: contracts.contractId,
      title: contracts.title,
      description: contracts.description,
      buyer: contracts.buyer,
      publishedDate: contracts.publishedDate,
      awardedDate: contracts.awardedDate,
      awardedValue: contracts.awardedValue,
      awardedSuppliers: contracts.awardedSuppliers,
      cpvDescription: contracts.cpvDescription,
      region: contracts.region,
      rawData: contracts.rawData,
    })
    .from(contracts)
    .innerJoin(
      contractSupplierSearches,
      eq(contracts.id, contractSupplierSearches.contractId)
    )
    .where(eq(contractSupplierSearches.searchKeyword, searchKeyword));

  return cachedContracts;
}

async function storeContracts(
  searchKeyword: string,
  matchingContracts: {
    id: string;
    title: string;
    description: string | null;
    buyer: string;
    publishedDate: string;
    awardedDate: string;
    awardedValue: number | null;
    awardedSuppliers: string[];
    cpvDescription: string | null;
    region: string | null;
    rawData: any;
  }[]
) {
  const now = new Date();

  // Clear old search links for this keyword
  await db
    .delete(contractSupplierSearches)
    .where(eq(contractSupplierSearches.searchKeyword, searchKeyword));

  for (const contract of matchingContracts) {
    // Upsert contract (may already exist from another supplier search)
    const existingContract = await db
      .select({ id: contracts.id })
      .from(contracts)
      .where(eq(contracts.contractId, contract.id))
      .limit(1);

    let contractDbId: number;

    if (existingContract.length > 0) {
      contractDbId = existingContract[0].id;
      // Update fetchedAt and rawData
      await db
        .update(contracts)
        .set({ fetchedAt: now, rawData: contract.rawData })
        .where(eq(contracts.id, contractDbId));
    } else {
      const inserted = await db
        .insert(contracts)
        .values({
          contractId: contract.id,
          title: contract.title,
          description: contract.description,
          buyer: contract.buyer,
          publishedDate: contract.publishedDate
            ? new Date(contract.publishedDate)
            : null,
          awardedDate: contract.awardedDate
            ? new Date(contract.awardedDate)
            : null,
          awardedValue: contract.awardedValue?.toString() ?? null,
          awardedSuppliers: contract.awardedSuppliers,
          cpvDescription: contract.cpvDescription,
          region: contract.region,
          rawData: contract.rawData,
          fetchedAt: now,
        })
        .returning({ id: contracts.id });
      contractDbId = inserted[0].id;
    }

    // Link contract to this search keyword
    await db
      .insert(contractSupplierSearches)
      .values({
        searchKeyword,
        contractId: contractDbId,
      })
      .onConflictDoNothing();
  }
}

function normalizeForComparison(str: string): string {
  return str
    .toLowerCase()
    .replace(/&#039;/g, "'") // Decode HTML entities
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .replace(/[.,()'"&]/g, "")
    .replace(/\b(limited|ltd|plc|llp|inc|gmbh)\b/g, "") // Remove corporate suffixes
    .replace(/\b(the)\b/g, "") // Remove "The"
    .trim();
}

function supplierMatches(awardedSupplier: string, searchName: string): boolean {
  const normalizedAwarded = normalizeForComparison(awardedSupplier);
  const normalizedSearch = normalizeForComparison(searchName);

  // Safety check: if normalization leaves us with empty strings (e.g. input was just "Limited")
  if (!normalizedAwarded || !normalizedSearch) return false;

  // 1. Exact match of core name
  if (normalizedAwarded === normalizedSearch) return true;

  // 2. String similarity check
  // Using Dice's coefficient to find similarity between the two strings
  // Threshold of 0.85 is generally good for company names to handle small typos or differences
  const similarity = stringSimilarity.compareTwoStrings(
    normalizedAwarded,
    normalizedSearch
  );
  if (similarity >= 0.85) return true;

  // 3. Check for word overlap
  const wordsAwarded = normalizedAwarded.split(" ");
  const wordsSearch = normalizedSearch.split(" ");

  const [shorter, longer] =
    wordsAwarded.length < wordsSearch.length
      ? [wordsAwarded, wordsSearch]
      : [wordsSearch, wordsAwarded];

  // If the shorter name is just one word, be very strict (must be exact match or very unique)
  // This prevents "Construction" matching "Mclaren Construction"
  if (shorter.length === 1) {
    return longer.includes(shorter[0]) && shorter[0].length > 4; // Only match single words if > 4 chars
  }

  // Check if all words in the shorter name appear in sequence in the longer name
  const shorterPhrase = shorter.join(" ");
  const longerPhrase = longer.join(" ");

  return longerPhrase.includes(shorterPhrase);
}

function parseAwardedSuppliers(awardedSupplier: string | null): string[] {
  if (!awardedSupplier) return [];
  // Split by comma and clean up each supplier name
  return (
    awardedSupplier
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      // Filter out common invalid splits
      .filter((s) => {
        const normalized = normalizeForComparison(s);
        return !["ltd", "limited", "plc", "llp"].includes(normalized);
      })
      // Remove duplicates
      .filter((value, index, self) => self.indexOf(value) === index)
  );
}

function reorderSuppliersToPutCurrentFirst(
  suppliers: string[],
  currentSupplier: string
): string[] {
  if (suppliers.length === 0) return suppliers;

  // Find the index of the matching supplier
  const matchingIndex = suppliers.findIndex((supplier) =>
    supplierMatches(supplier, currentSupplier)
  );

  if (matchingIndex === -1 || matchingIndex === 0) {
    // No match found or already first
    return suppliers;
  }

  // Move matching supplier to first position
  const reordered = [...suppliers];
  const [matchingSupplier] = reordered.splice(matchingIndex, 1);
  return [matchingSupplier, ...reordered];
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supplierId = parseInt(id);

  if (isNaN(supplierId)) {
    return NextResponse.json({ error: "Invalid supplier ID" }, { status: 400 });
  }

  try {
    // Get supplier name and linked company/council
    const supplierRes = await db.execute(
      sql.raw(`
        SELECT 
          s.name as supplier_name,
          c.company_number,
          e.name as entity_name,
          e.entity_type
        FROM suppliers s
        LEFT JOIN companies c ON c.entity_id = s.entity_id
        LEFT JOIN entities e ON e.id = s.entity_id
        WHERE s.id = ${supplierId}
        LIMIT 1
      `)
    );

    const supplierData = supplierRes.rows[0] as
      | { 
          supplier_name: string; 
          company_number: string | null; 
          entity_name: string | null;
          entity_type: string | null;
        }
      | undefined;

    if (!supplierData) {
      return NextResponse.json({ error: "Supplier not found" }, { status: 404 });
    }

    const { 
      supplier_name: supplierName, 
      company_number: companyNumber, 
      entity_name: entityName,
      entity_type: entityType
    } = supplierData;

    let searchKeyword: string;
    let searchMethod: "companies_house" | "council" | "keyword";

    if (entityType === "company" && companyNumber && entityName) {
      searchKeyword = entityName;
      searchMethod = "companies_house";
    } else if (entityType === "council" && entityName) {
      searchKeyword = entityName;
      searchMethod = "council";
    } else {
      searchKeyword = supplierName;
      searchMethod = "keyword";
    }

    // Check cache first
    console.log("[Contracts Finder API] Checking cache", {
      supplierName,
      searchKeyword,
      searchMethod,
      timestamp: new Date().toISOString(),
    });

    const cachedContracts = await getCachedContracts(searchKeyword);
    if (cachedContracts && cachedContracts.length > 0) {
      console.log("[Contracts Finder API] Cache hit", {
        supplierName,
        searchKeyword,
        cachedCount: cachedContracts.length,
        timestamp: new Date().toISOString(),
      });
      const contractsResponse = cachedContracts
        .map((c) => {
          const suppliers = c.awardedSuppliers || [];
          const reorderedSuppliers = reorderSuppliersToPutCurrentFirst(
            suppliers,
            searchKeyword
          );
          return {
            id: c.contractId,
            title: c.title,
            description: c.description?.substring(0, 300) || null,
            buyer: c.buyer,
            publishedDate: c.publishedDate?.toISOString() || null,
            awardedDate: c.awardedDate?.toISOString() || null,
            awardedValue: c.awardedValue ? parseFloat(c.awardedValue) : null,
            awardedSuppliers: reorderedSuppliers,
            totalSuppliers: reorderedSuppliers.length,
            cpvDescription: c.cpvDescription,
            region: c.region,
            rawData: c.rawData,
          };
        })
        .sort((a, b) => {
          const dateA = new Date(a.awardedDate || 0).getTime();
          const dateB = new Date(b.awardedDate || 0).getTime();
          return dateB - dateA;
        })
        .slice(0, 10);

      return NextResponse.json({
        contracts: contractsResponse,
        hitCount: contractsResponse.length,
        totalMatching: cachedContracts.length,
        searchMethod,
        searchKeyword,
        companiesHouseNumber: companyNumber,
        cached: true,
      });
    }

    console.log("[Contracts Finder API] Cache miss, fetching from API", {
      supplierName,
      searchKeyword,
      timestamp: new Date().toISOString(),
    });

    // Fetch from API
    console.log("[Contracts Finder API] Fetching contracts from API", {
      supplierName,
      searchKeyword,
      searchMethod,
      companiesHouseNumber: companyNumber,
      timestamp: new Date().toISOString(),
    });

    const searchData = await searchContractsFromAPI(searchKeyword);
    const searchResults = (searchData.noticeList ||
      []) as ContractsFinderSearchResult[];

    console.log("[Contracts Finder API] Received API response", {
      supplierName,
      searchKeyword,
      totalHits: searchData.hitCount || 0,
      totalNotices: searchResults.length,
      timestamp: new Date().toISOString(),
    });

    // Filter to only include contracts where this supplier is in awardedSupplier
    const matchingContracts = searchResults
      .filter((result) => {
        if (!result.item.awardedSupplier) return false;
        const suppliers = parseAwardedSuppliers(result.item.awardedSupplier);
        return suppliers.some((supplier) =>
          supplierMatches(supplier, searchKeyword)
        );
      })
      .map((result) => {
        const allSuppliers = parseAwardedSuppliers(result.item.awardedSupplier);
        const reorderedSuppliers = reorderSuppliersToPutCurrentFirst(
          allSuppliers,
          searchKeyword
        );
        return {
          id: result.item.id,
          title: result.item.title,
          description: result.item.description?.substring(0, 300) || null,
          buyer: result.item.organisationName,
          publishedDate: result.item.publishedDate,
          awardedDate: result.item.awardedDate,
          awardedValue: result.item.awardedValue,
          awardedSuppliers: reorderedSuppliers,
          totalSuppliers: reorderedSuppliers.length,
          cpvDescription: result.item.cpvDescription,
          region: result.item.region,
          rawData: result, // Store the full result object from API response
        };
      });

    console.log("[Contracts Finder API] Filtered matching contracts", {
      supplierName,
      searchKeyword,
      totalNotices: searchResults.length,
      matchingCount: matchingContracts.length,
      timestamp: new Date().toISOString(),
    });

    // Store contracts in database
    if (matchingContracts.length > 0) {
      console.log("[Contracts Finder API] Storing contracts in database", {
        supplierName,
        searchKeyword,
        contractCount: matchingContracts.length,
        timestamp: new Date().toISOString(),
      });
      await storeContracts(searchKeyword, matchingContracts);
      console.log("[Contracts Finder API] Successfully stored contracts", {
        supplierName,
        searchKeyword,
        contractCount: matchingContracts.length,
        timestamp: new Date().toISOString(),
      });
    } else {
      console.log("[Contracts Finder API] No matching contracts to store", {
        supplierName,
        searchKeyword,
        timestamp: new Date().toISOString(),
      });
    }

    // Sort by awarded date descending and take latest 10
    const contractsResponse = matchingContracts
      .sort((a, b) => {
        const dateA = new Date(a.awardedDate || 0).getTime();
        const dateB = new Date(b.awardedDate || 0).getTime();
        return dateB - dateA;
      })
      .slice(0, 10);

    return NextResponse.json({
      contracts: contractsResponse,
      hitCount: contractsResponse.length,
      totalSearchHits: searchData.hitCount || 0,
      totalMatching: matchingContracts.length,
      searchMethod,
      searchKeyword,
      companiesHouseNumber: companyNumber,
      cached: false,
    });
  } catch (error) {
    console.error("Error fetching contracts:", error);
    return NextResponse.json({
      contracts: [],
      hitCount: 0,
      error: "Failed to fetch contracts",
      searchMethod: "keyword",
      searchKeyword: supplierName,
    });
  }
}
