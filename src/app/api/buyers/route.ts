import { db } from "@/db";
import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";

// National/regional parent organisations to show in summary, not in table
const PARENT_ORG_FILTER = `('Department of Health and Social Care', 'DHSC', 'NHS England', 'NHS Business Services Authority')`;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const search = searchParams.get("search") || "";
  const page = parseInt(searchParams.get("page") || "1");
  const limit = parseInt(searchParams.get("limit") || "20");
  const offset = (page - 1) * limit;

  // Date range parameters
  const startDate = searchParams.get("startDate") || "";
  const endDate = searchParams.get("endDate") || "";

  // Build date filter SQL
  const dateFilter =
    startDate && endDate
      ? `AND se.payment_date >= '${startDate}' AND se.payment_date <= '${endDate}'`
      : "";
  const dateFilterForSubquery =
    startDate && endDate
      ? `AND se2.payment_date >= '${startDate}' AND se2.payment_date <= '${endDate}'`
      : "";

  try {
    // Get parent buyers' spending (for top-line figures)
    const parentOrgsRes = await db.execute(
      sql.raw(`
      SELECT 
        b.id,
        e.name,
        COALESCE(SUM(se.amount), 0) as total_spend,
        COUNT(DISTINCT se.raw_supplier) as supplier_count
      FROM buyers b
      LEFT JOIN entities e ON b.entity_id = e.id
      LEFT JOIN spend_entries se ON b.id = se.buyer_id ${
        dateFilter
          ? `AND se.payment_date >= '${startDate}' AND se.payment_date <= '${endDate}'`
          : ""
      }
      WHERE e.name IN ${PARENT_ORG_FILTER}
      GROUP BY b.id, e.name
      ORDER BY total_spend DESC
    `)
    );

    // Get summary statistics (excluding parent orgs from counts)
    const summaryRes = await db.execute(
      sql.raw(`
      SELECT 
        (SELECT COUNT(DISTINCT se.buyer_id) 
         FROM spend_entries se 
         JOIN buyers b ON b.id = se.buyer_id 
         JOIN entities e ON b.entity_id = e.id
         WHERE e.name NOT IN ${PARENT_ORG_FILTER} ${dateFilter}) as total_buyers,
        (SELECT COUNT(DISTINCT se.buyer_id) 
         FROM spend_entries se 
         JOIN buyers b ON b.id = se.buyer_id 
         JOIN entities e ON b.entity_id = e.id
         WHERE payment_date >= CURRENT_DATE - INTERVAL '90 days'
         AND e.name NOT IN ${PARENT_ORG_FILTER} ${dateFilter}) as active_last_90_days,
        (SELECT SUM(amount) FROM spend_entries se 
         JOIN buyers b ON b.id = se.buyer_id
         JOIN entities e ON b.entity_id = e.id
         WHERE e.name NOT IN ${PARENT_ORG_FILTER} ${dateFilter}) as total_spend
    `)
    );
    const summaryResult = summaryRes.rows[0] as any;

    // Get buyer data (sub-organisations only, excluding parent orgs)
    const buyersQuery = search
      ? sql`
        WITH buyer_stats AS (
          SELECT 
            b.id,
            e.name,
            nhs.org_sub_type as trust_type,
            COALESCE(SUM(se.amount), 0) as total_spend,
            COUNT(DISTINCT se.raw_supplier) as supplier_count,
            (
              SELECT raw_supplier 
              FROM spend_entries se2 
              WHERE se2.buyer_id = b.id ${sql.raw(dateFilterForSubquery)}
              GROUP BY raw_supplier 
              ORDER BY SUM(amount) DESC 
              LIMIT 1
            ) as top_supplier
          FROM buyers b
          LEFT JOIN entities e ON b.entity_id = e.id
          LEFT JOIN nhs_organisations nhs ON e.id = nhs.entity_id
          LEFT JOIN spend_entries se ON b.id = se.buyer_id ${sql.raw(
            dateFilter
          )}
          WHERE e.name ILIKE ${"%" + search + "%"}
            AND e.name NOT IN ('Department of Health and Social Care', 'DHSC', 'NHS England', 'NHS Business Services Authority')
          GROUP BY b.id, e.name, nhs.org_sub_type
          HAVING COALESCE(SUM(se.amount), 0) > 0
          ORDER BY total_spend DESC
        )
        SELECT * FROM buyer_stats
        LIMIT ${limit} OFFSET ${offset}
      `
      : sql.raw(`
        WITH buyer_stats AS (
          SELECT 
            b.id,
            e.name,
            nhs.org_sub_type as trust_type,
            COALESCE(SUM(se.amount), 0) as total_spend,
            COUNT(DISTINCT se.raw_supplier) as supplier_count,
            (
              SELECT raw_supplier 
              FROM spend_entries se2 
              WHERE se2.buyer_id = b.id ${dateFilterForSubquery}
              GROUP BY raw_supplier 
              ORDER BY SUM(amount) DESC 
              LIMIT 1
            ) as top_supplier
          FROM buyers b
          LEFT JOIN entities e ON b.entity_id = e.id
          LEFT JOIN nhs_organisations nhs ON e.id = nhs.entity_id
          LEFT JOIN spend_entries se ON b.id = se.buyer_id ${dateFilter}
          WHERE e.name NOT IN ${PARENT_ORG_FILTER}
          GROUP BY b.id, e.name, nhs.org_sub_type
          HAVING COALESCE(SUM(se.amount), 0) > 0
          ORDER BY total_spend DESC
        )
        SELECT * FROM buyer_stats
        LIMIT ${limit} OFFSET ${offset}
      `);

    const buyers = await db.execute(buyersQuery);

    // Get total count for pagination (excluding parent orgs)
    const countRes = search
      ? sql`
          SELECT COUNT(DISTINCT b.id) as count
          FROM buyers b
          JOIN entities e ON b.entity_id = e.id
          INNER JOIN spend_entries se ON b.id = se.buyer_id ${sql.raw(
            dateFilter
          )}
          WHERE e.name ILIKE ${"%" + search + "%"}
            AND e.name NOT IN ('Department of Health and Social Care', 'DHSC', 'NHS England', 'NHS Business Services Authority')
        `
      : sql.raw(`
          SELECT COUNT(DISTINCT b.id) as count
          FROM buyers b
          JOIN entities e ON b.entity_id = e.id
          INNER JOIN spend_entries se ON b.id = se.buyer_id ${dateFilter}
          WHERE e.name NOT IN ${PARENT_ORG_FILTER}
        `);
    const countResult = (await db.execute(countRes)).rows[0] as any;

    return NextResponse.json({
      summary: {
        totalBuyers: Number(summaryResult?.total_buyers) || 0,
        activeLast90Days: Number(summaryResult?.active_last_90_days) || 0,
        totalSpend: Number(summaryResult?.total_spend) || 0,
      },
      parentOrganisations: parentOrgsRes.rows,
      buyers: buyers.rows,
      pagination: {
        page,
        limit,
        total: Number(countResult?.count) || 0,
        totalPages: Math.ceil(Number(countResult?.count) / limit),
      },
    });
  } catch (error) {
    console.error("Error fetching buyers:", error);
    return NextResponse.json(
      { error: "Failed to fetch buyers data" },
      { status: 500 }
    );
  }
}
