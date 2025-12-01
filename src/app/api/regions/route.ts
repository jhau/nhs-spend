import { db } from "@/db";
import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";

// Map organisation names to NHS regions
const REGION_PATTERNS: Record<string, string[]> = {
  "London": ["London", "North Central London", "North East London", "North West London", "South East London", "South West London"],
  "South East": ["Kent", "Surrey", "Sussex", "Hampshire", "Isle of Wight", "Buckinghamshire", "Oxfordshire", "Berkshire", "Frimley"],
  "South West": ["Bristol", "Somerset", "Devon", "Cornwall", "Dorset", "Gloucestershire", "Bath"],
  "East of England": ["Norfolk", "Suffolk", "Cambridge", "Essex", "Hertfordshire", "Bedford"],
  "Midlands": ["Birmingham", "Coventry", "Warwickshire", "Leicester", "Nottingham", "Derby", "Staffordshire", "Shropshire", "Worcester", "Black Country", "Solihull"],
  "North West": ["Manchester", "Liverpool", "Cheshire", "Merseyside", "Lancashire", "Cumbria"],
  "North East": ["Newcastle", "Durham", "Sunderland", "Tees", "Northumberland", "North East"],
  "Yorkshire": ["Yorkshire", "Leeds", "Sheffield", "Bradford", "Hull", "York", "Humber"],
  "Wales": ["Wales", "Welsh", "Cardiff", "Swansea"],
  "Scotland": ["Scotland", "Scottish", "Edinburgh", "Glasgow"],
};

function getRegionFromName(name: string): string {
  const upperName = name.toUpperCase();
  for (const [region, patterns] of Object.entries(REGION_PATTERNS)) {
    for (const pattern of patterns) {
      if (upperName.includes(pattern.toUpperCase())) {
        return region;
      }
    }
  }
  return "Other";
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const startDate = searchParams.get("startDate") || "";
  const endDate = searchParams.get("endDate") || "";
  const selectedRegion = searchParams.get("region") || "";

  const dateFilter = startDate && endDate
    ? `AND se.payment_date >= '${startDate}' AND se.payment_date <= '${endDate}'`
    : "";

  try {
    // Get all organisations with their spend data
    const orgsRes = await db.execute(sql.raw(`
      SELECT 
        o.id,
        o.name,
        o.trust_type,
        COALESCE(SUM(se.amount), 0) as total_spend,
        COUNT(DISTINCT se.supplier) as supplier_count,
        COUNT(DISTINCT DATE_TRUNC('month', se.payment_date)) as active_months
      FROM organisations o
      LEFT JOIN spend_entries se ON o.id = se.organisation_id ${dateFilter ? `AND se.payment_date >= '${startDate}' AND se.payment_date <= '${endDate}'` : ""}
      WHERE o.name NOT IN ('Department of Health and Social Care', 'DHSC', 'NHS England', 'NHS Business Services Authority')
      GROUP BY o.id, o.name, o.trust_type
      HAVING COALESCE(SUM(se.amount), 0) > 0
    `));

    // Group by region
    const regionData: Record<string, {
      totalSpend: number;
      buyers: number;
      suppliers: Set<string>;
      organisations: Array<{ id: number; name: string; spend: number; supplierCount: number }>;
    }> = {};

    for (const org of orgsRes.rows as any[]) {
      const region = getRegionFromName(org.name);
      if (!regionData[region]) {
        regionData[region] = {
          totalSpend: 0,
          buyers: 0,
          suppliers: new Set(),
          organisations: [],
        };
      }
      regionData[region].totalSpend += parseFloat(org.total_spend) || 0;
      regionData[region].buyers += 1;
      regionData[region].organisations.push({
        id: org.id,
        name: org.name,
        spend: parseFloat(org.total_spend) || 0,
        supplierCount: parseInt(org.supplier_count) || 0,
      });
    }

    // Format regions for response
    const regions = Object.entries(regionData)
      .map(([name, data]) => ({
        name,
        totalSpend: data.totalSpend,
        buyers: data.buyers,
        topBuyers: data.organisations
          .sort((a, b) => b.spend - a.spend)
          .slice(0, 5),
        spendLevel: data.totalSpend > 20_000_000_000 ? "high" : data.totalSpend > 5_000_000_000 ? "medium" : "low",
      }))
      .sort((a, b) => b.totalSpend - a.totalSpend);

    // Get selected region details if specified
    let regionSnapshot = null;
    if (selectedRegion && regionData[selectedRegion]) {
      const data = regionData[selectedRegion];
      
      // Get top suppliers for this region
      const topSuppliersRes = await db.execute(sql.raw(`
        SELECT 
          se.supplier,
          SUM(se.amount) as total_spend
        FROM spend_entries se
        JOIN organisations o ON o.id = se.organisation_id
        WHERE o.name NOT IN ('Department of Health and Social Care', 'DHSC', 'NHS England', 'NHS Business Services Authority')
        ${dateFilter}
        GROUP BY se.supplier
        ORDER BY total_spend DESC
        LIMIT 5
      `));

      regionSnapshot = {
        name: selectedRegion,
        totalSpend: data.totalSpend,
        activeBuyers: data.buyers,
        topBuyers: data.organisations.sort((a, b) => b.spend - a.spend).slice(0, 5),
        topSuppliers: (topSuppliersRes.rows as any[]).map(s => ({
          name: s.supplier,
          spend: parseFloat(s.total_spend),
        })),
        spendLevel: data.totalSpend > 20_000_000_000 ? "high" : data.totalSpend > 5_000_000_000 ? "medium" : "low",
      };
    }

    // Calculate totals
    const totalSpend = regions.reduce((sum, r) => sum + r.totalSpend, 0);
    const totalBuyers = regions.reduce((sum, r) => sum + r.buyers, 0);

    return NextResponse.json({
      summary: {
        totalSpend,
        totalBuyers,
        totalRegions: regions.length,
      },
      regions,
      regionSnapshot,
    });
  } catch (error) {
    console.error("Error fetching regions:", error);
    return NextResponse.json(
      { error: "Failed to fetch regional data" },
      { status: 500 }
    );
  }
}

