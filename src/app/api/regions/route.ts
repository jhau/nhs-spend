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
    // Get all organisations with their spend data (using new schema)
    const orgsRes = await db.execute(sql.raw(`
      SELECT 
        o.id,
        e.name,
        nhs.org_sub_type as trust_type,
        nhs.ods_code,
        nhs.parent_ods_code as icb_ods_code,
        e.latitude,
        e.longitude,
        COALESCE(SUM(se.amount), 0) as total_spend,
        COUNT(DISTINCT se.raw_supplier) as supplier_count,
        COUNT(DISTINCT DATE_TRUNC('month', se.payment_date)) as active_months
      FROM organisations o
      LEFT JOIN entities e ON o.entity_id = e.id
      LEFT JOIN nhs_organisations nhs ON e.id = nhs.entity_id
      LEFT JOIN spend_entries se ON o.id = se.organisation_id ${dateFilter ? `AND se.payment_date >= '${startDate}' AND se.payment_date <= '${endDate}'` : ""}
      WHERE e.name NOT IN ('Department of Health and Social Care', 'DHSC', 'NHS England', 'NHS Business Services Authority')
      GROUP BY o.id, e.name, nhs.org_sub_type, nhs.ods_code, nhs.parent_ods_code, e.latitude, e.longitude
      HAVING COALESCE(SUM(se.amount), 0) > 0
    `));

    // Group by region
    interface OrgData {
      id: number;
      name: string;
      spend: number;
      supplierCount: number;
      latitude: number | null;
      longitude: number | null;
      odsCode: string | null;
      icbOdsCode: string | null;
      isIcb: boolean;
      trusts: OrgData[];
    }

    const regionData: Record<string, {
      totalSpend: number;
      buyers: number;
      suppliers: Set<string>;
      organisations: OrgData[];
    }> = {};

    // First pass: collect all organisations and group trusts by ICB ODS code
    const allOrgs: OrgData[] = [];
    const icbByOdsCode: Map<string, OrgData> = new Map();
    const trustsByIcbOdsCode: Map<string, OrgData[]> = new Map();

    for (const org of orgsRes.rows as any[]) {
      const isIcb = org.name?.toUpperCase().includes(' ICB') || org.name?.toUpperCase().includes('INTEGRATED CARE BOARD');
      const orgData: OrgData = {
        id: org.id,
        name: org.name,
        spend: parseFloat(org.total_spend) || 0,
        supplierCount: parseInt(org.supplier_count) || 0,
        latitude: org.latitude ? parseFloat(org.latitude) : null,
        longitude: org.longitude ? parseFloat(org.longitude) : null,
        odsCode: org.ods_code || null,
        icbOdsCode: org.icb_ods_code || null,
        isIcb,
        trusts: [],
      };
      allOrgs.push(orgData);

      if (isIcb && org.ods_code) {
        icbByOdsCode.set(org.ods_code, orgData);
      }

      // Group trusts by their parent ICB ODS code
      if (!isIcb && org.icb_ods_code) {
        const trusts = trustsByIcbOdsCode.get(org.icb_ods_code) || [];
        trusts.push(orgData);
        trustsByIcbOdsCode.set(org.icb_ods_code, trusts);
      }
    }

    // Second pass: assign trusts to their parent ICBs using icb_ods_code
    // Track which trusts have been assigned to an ICB
    const trustsWithParentIcb = new Set<number>();
    
    for (const [icbOdsCode, trusts] of trustsByIcbOdsCode.entries()) {
      const parentIcb = icbByOdsCode.get(icbOdsCode);
      if (parentIcb) {
        parentIcb.trusts = trusts.sort((a, b) => b.spend - a.spend);
        // Mark these trusts as having a parent ICB
        for (const trust of trusts) {
          trustsWithParentIcb.add(trust.id);
        }
      }
    }

    // Third pass: group by region
    // Only add ICBs and standalone trusts (trusts without a parent ICB in data)
    for (const org of allOrgs) {
      const region = getRegionFromName(org.name || "");
      if (!regionData[region]) {
        regionData[region] = {
          totalSpend: 0,
          buyers: 0,
          suppliers: new Set(),
          organisations: [],
        };
      }
      regionData[region].totalSpend += org.spend;
      regionData[region].buyers += 1;
      
      // Only add to organisations list if it's an ICB or a trust without a parent ICB
      if (org.isIcb || !trustsWithParentIcb.has(org.id)) {
        regionData[region].organisations.push(org);
      }
    }

    // Format regions for response
    const regions = Object.entries(regionData)
      .map(([name, data]) => {
        // Get all trusts for map markers (flatten trusts from ICBs + standalone trusts)
        const allTrusts: OrgData[] = [];
        for (const org of data.organisations) {
          if (org.isIcb) {
            // Add all trusts under this ICB
            allTrusts.push(...org.trusts);
          } else {
            // Add standalone trust
            allTrusts.push(org);
          }
        }
        
        return {
          name,
          totalSpend: data.totalSpend,
          buyers: data.buyers,
          topBuyers: data.organisations
            .sort((a, b) => b.spend - a.spend)
            .slice(0, 20),
          // Trusts only (for map markers)
          trustLocations: allTrusts
            .filter(t => t.latitude && t.longitude)
            .sort((a, b) => b.spend - a.spend)
            .slice(0, 50),
          spendLevel: data.totalSpend > 20_000_000_000 ? "high" : data.totalSpend > 5_000_000_000 ? "medium" : "low",
        };
      })
      .sort((a, b) => b.totalSpend - a.totalSpend);

    // Get selected region details if specified
    let regionSnapshot = null;
    if (selectedRegion && regionData[selectedRegion]) {
      const data = regionData[selectedRegion];
      
      // Get top suppliers for this region
      const topSuppliersRes = await db.execute(sql.raw(`
        SELECT 
          se.raw_supplier,
          SUM(se.amount) as total_spend
        FROM spend_entries se
        JOIN organisations o ON o.id = se.organisation_id
        JOIN entities e ON o.entity_id = e.id
        WHERE e.name NOT IN ('Department of Health and Social Care', 'DHSC', 'NHS England', 'NHS Business Services Authority')
        ${dateFilter}
        GROUP BY se.raw_supplier
        ORDER BY total_spend DESC
        LIMIT 5
      `));

      regionSnapshot = {
        name: selectedRegion,
        totalSpend: data.totalSpend,
        activeBuyers: data.buyers,
        topBuyers: data.organisations.sort((a, b) => b.spend - a.spend).slice(0, 5),
        topSuppliers: (topSuppliersRes.rows as any[]).map(s => ({
          name: s.raw_supplier,
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
