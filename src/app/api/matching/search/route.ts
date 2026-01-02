import { NextResponse } from "next/server";
import { searchCompanies, calculateSimilarity } from "@/lib/companies-house";
import { searchCouncilMetadata } from "@/lib/council-api";
import { searchGovUkOrganisation } from "@/lib/gov-uk";
import { searchNhsOrganisation } from "@/lib/nhs-api";
import stringSimilarity from "string-similarity";

export async function POST(req: Request) {
  const { query, supplierName, type = "company" } = await req.json();

  if (!query) {
    return NextResponse.json({ error: "Query is required" }, { status: 400 });
  }

  try {
    if (type === "company") {
      const apiKey = process.env.COMPANIES_HOUSE_API_KEY;
      if (!apiKey) {
        return NextResponse.json({ error: "Companies House API key not configured" }, { status: 500 });
      }
      const data = await searchCompanies(query, apiKey);
      
      if (supplierName && data.items) {
        data.items = data.items.map((item: any) => ({
          ...item,
          similarity: calculateSimilarity(supplierName, item.title)
        })).sort((a: any, b: any) => (b.similarity || 0) - (a.similarity || 0));
      }
      return NextResponse.json(data);
    } 
    
    if (type === "council") {
      const metadata = await searchCouncilMetadata(query);
      if (!metadata) return NextResponse.json({ items: [] });
      
      const similarity = supplierName 
        ? stringSimilarity.compareTwoStrings(supplierName.toLowerCase(), metadata.officialName.toLowerCase())
        : 1;

      return NextResponse.json({
        items: [{
          title: metadata.officialName,
          gss_code: metadata.gssCode,
          council_type: metadata.councilType,
          address_snippet: metadata.region || metadata.nation,
          similarity,
          metadata
        }]
      });
    }

    if (type === "government_department") {
      const profile = await searchGovUkOrganisation(query);
      if (!profile) return NextResponse.json({ items: [] });

      const similarity = supplierName 
        ? stringSimilarity.compareTwoStrings(supplierName.toLowerCase(), profile.title.toLowerCase())
        : 1;

      return NextResponse.json({
        items: [{
          title: profile.title,
          slug: profile.slug,
          organisation_type: profile.organisation_type,
          address_snippet: profile.organisation_state,
          similarity,
          profile
        }]
      });
    }

    if (type === "nhs_trust") {
      const orgs = await searchNhsOrganisation(query);
      
      const items = orgs.map(org => ({
        title: org.Name,
        ods_code: org.OrgId,
        primary_role: org.PrimaryRoleDescription,
        address_snippet: `${org.PostCode}`,
        similarity: supplierName 
          ? stringSimilarity.compareTwoStrings(supplierName.toLowerCase(), org.Name.toLowerCase())
          : 1,
        org
      })).sort((a, b) => b.similarity - a.similarity);

      return NextResponse.json({ items });
    }

    return NextResponse.json({ error: "Invalid type" }, { status: 400 });
  } catch (error: any) {
    console.error(`Error searching for ${type}:`, error);
    return NextResponse.json({ error: error.message || `Failed to search ${type}` }, { status: 500 });
  }
}
