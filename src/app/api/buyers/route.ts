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
    // Get parent organisations' spending (for top-line figures)
    const parentOrgsRes = await db.execute(
      sql.raw(`
      SELECT 
        o.id,
        o.name,
        COALESCE(SUM(se.amount), 0) as total_spend,
        COUNT(DISTINCT se.raw_supplier) as supplier_count
      FROM organisations o
      LEFT JOIN spend_entries se ON o.id = se.organisation_id ${
        dateFilter
          ? `AND se.payment_date >= '${startDate}' AND se.payment_date <= '${endDate}'`
          : ""
      }
      WHERE o.name IN ${PARENT_ORG_FILTER}
      GROUP BY o.id, o.name
      ORDER BY total_spend DESC
    `)
    );

    // Get summary statistics (excluding parent orgs from counts)
    const summaryRes = await db.execute(
      sql.raw(`
      SELECT 
        (SELECT COUNT(DISTINCT se.organisation_id) 
         FROM spend_entries se 
         JOIN organisations o ON o.id = se.organisation_id 
         WHERE o.name NOT IN ${PARENT_ORG_FILTER} ${dateFilter}) as total_buyers,
        (SELECT COUNT(DISTINCT se.organisation_id) 
         FROM spend_entries se 
         JOIN organisations o ON o.id = se.organisation_id 
         WHERE payment_date >= CURRENT_DATE - INTERVAL '90 days'
         AND o.name NOT IN ${PARENT_ORG_FILTER} ${dateFilter}) as active_last_90_days,
        (SELECT SUM(amount) FROM spend_entries se 
         JOIN organisations o ON o.id = se.organisation_id
         WHERE o.name NOT IN ${PARENT_ORG_FILTER} ${dateFilter}) as total_spend
    `)
    );
    const summaryResult = summaryRes.rows[0] as any;

    // Get buyer data (sub-organisations only, excluding parent orgs)
    const buyersQuery = search
      ? sql`
        WITH buyer_stats AS (
          SELECT 
            o.id,
            o.name,
            o.trust_type,
            COALESCE(SUM(se.amount), 0) as total_spend,
            COUNT(DISTINCT se.raw_supplier) as supplier_count,
            (
              SELECT raw_supplier 
              FROM spend_entries se2 
              WHERE se2.organisation_id = o.id ${sql.raw(dateFilterForSubquery)}
              GROUP BY raw_supplier 
              ORDER BY SUM(amount) DESC 
              LIMIT 1
            ) as top_supplier
          FROM organisations o
          LEFT JOIN spend_entries se ON o.id = se.organisation_id ${sql.raw(
            dateFilter
          )}
          WHERE o.name ILIKE ${"%" + search + "%"}
            AND o.name NOT IN ('Department of Health and Social Care', 'DHSC', 'NHS England', 'NHS Business Services Authority')
          GROUP BY o.id, o.name, o.trust_type
          HAVING COALESCE(SUM(se.amount), 0) > 0
          ORDER BY total_spend DESC
        )
        SELECT * FROM buyer_stats
        LIMIT ${limit} OFFSET ${offset}
      `
      : sql.raw(`
        WITH buyer_stats AS (
          SELECT 
            o.id,
            o.name,
            o.trust_type,
            COALESCE(SUM(se.amount), 0) as total_spend,
            COUNT(DISTINCT se.raw_supplier) as supplier_count,
            (
              SELECT raw_supplier 
              FROM spend_entries se2 
              WHERE se2.organisation_id = o.id ${dateFilterForSubquery}
              GROUP BY raw_supplier 
              ORDER BY SUM(amount) DESC 
              LIMIT 1
            ) as top_supplier
          FROM organisations o
          LEFT JOIN spend_entries se ON o.id = se.organisation_id ${dateFilter}
          WHERE o.name NOT IN ${PARENT_ORG_FILTER}
          GROUP BY o.id, o.name, o.trust_type
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
          SELECT COUNT(DISTINCT o.id) as count
          FROM organisations o
          INNER JOIN spend_entries se ON o.id = se.organisation_id ${sql.raw(
            dateFilter
          )}
          WHERE o.name ILIKE ${"%" + search + "%"}
            AND o.name NOT IN ('Department of Health and Social Care', 'DHSC', 'NHS England', 'NHS Business Services Authority')
        `
      : sql.raw(`
          SELECT COUNT(DISTINCT o.id) as count
          FROM organisations o
          INNER JOIN spend_entries se ON o.id = se.organisation_id ${dateFilter}
          WHERE o.name NOT IN ${PARENT_ORG_FILTER}
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
