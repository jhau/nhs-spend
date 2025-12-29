import { NextResponse } from "next/server";
import { searchCompanies, calculateSimilarity } from "@/lib/companies-house";

export async function POST(req: Request) {
  const { query, supplierName } = await req.json();
  const apiKey = process.env.COMPANIES_HOUSE_API_KEY;

  if (!apiKey) {
    return NextResponse.json({ error: "API key not configured" }, { status: 500 });
  }

  if (!query) {
    return NextResponse.json({ error: "Query is required" }, { status: 400 });
  }

  try {
    const data = await searchCompanies(query, apiKey);
    
    // Calculate similarity if supplierName is provided
    if (supplierName && data.items) {
      data.items = data.items.map(item => ({
        ...item,
        similarity: calculateSimilarity(supplierName, item.title)
      })).sort((a: any, b: any) => (b.similarity || 0) - (a.similarity || 0));
    }

    return NextResponse.json(data);
  } catch (error: any) {
    console.error("Error searching Companies House:", error);
    return NextResponse.json({ error: error.message || "Failed to search Companies House" }, { status: 500 });
  }
}
