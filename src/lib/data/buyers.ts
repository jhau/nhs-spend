import { db } from "@/db";
import { sql } from "drizzle-orm";

// National/regional parent organisations to show in summary, not in table
const PARENT_ORG_FILTER = `('Department of Health and Social Care', 'DHSC', 'NHS England', 'NHS Business Services Authority')`;

export interface GetBuyersParams {
  search?: string;
  page?: number;
  limit?: number;
  startDate?: string;
  endDate?: string;
  orgType?: string;
}

export async function getBuyersData(params: GetBuyersParams) {
  const {
    search = "",
    page = 1,
    limit = 20,
    startDate = "",
    endDate = "",
    orgType = "",
  } = params;

  const offset = (page - 1) * limit;

  // Build type filter SQL
  let typeFilter = "";
  if (orgType === "nhs") {
    typeFilter = `AND (e.entity_type LIKE 'nhs_%' OR nhs.entity_id IS NOT NULL OR b.entity_id IS NULL)`;
  } else if (orgType === "council") {
    typeFilter = `AND (e.entity_type = 'council' OR c.entity_id IS NOT NULL)`;
  } else if (orgType === "gov") {
    typeFilter = `AND gd.entity_id IS NOT NULL`;
  }

  // Build date filter SQL
  const dateFilter =
    startDate && endDate
      ? `AND se.payment_date >= '${startDate}' AND se.payment_date <= '${endDate}'`
      : "";
  const dateFilterForSubquery =
    startDate && endDate
      ? `AND se2.payment_date >= '${startDate}' AND se2.payment_date <= '${endDate}'`
      : "";

  // Execute all independent queries in parallel for better performance
  const [summaryRes, buyersRes, countRes, typeStatsRes, parentOrgsRes] =
    await Promise.all([
      // 1. Summary statistics
      db.execute(
        sql.raw(`
      SELECT 
        (SELECT COUNT(DISTINCT se.buyer_id) 
         FROM spend_entries se 
         JOIN buyers b ON b.id = se.buyer_id 
         LEFT JOIN entities e ON b.entity_id = e.id
         LEFT JOIN nhs_organisations nhs ON e.id = nhs.entity_id
         LEFT JOIN councils c ON e.id = c.entity_id
         LEFT JOIN government_departments gd ON e.id = gd.entity_id
         WHERE (e.name IS NULL OR e.name NOT IN ${PARENT_ORG_FILTER}) ${dateFilter} ${typeFilter}) as total_buyers,
        (SELECT COUNT(DISTINCT se.buyer_id) 
         FROM spend_entries se 
         JOIN buyers b ON b.id = se.buyer_id 
         LEFT JOIN entities e ON b.entity_id = e.id
         LEFT JOIN nhs_organisations nhs ON e.id = nhs.entity_id
         LEFT JOIN councils c ON e.id = c.entity_id
         LEFT JOIN government_departments gd ON e.id = gd.entity_id
         WHERE payment_date >= CURRENT_DATE - INTERVAL '90 days'
         AND (e.name IS NULL OR e.name NOT IN ${PARENT_ORG_FILTER}) ${dateFilter} ${typeFilter}) as active_last_90_days,
        (SELECT SUM(amount) FROM spend_entries se 
         JOIN buyers b ON b.id = se.buyer_id
         LEFT JOIN entities e ON b.entity_id = e.id
         LEFT JOIN nhs_organisations nhs ON e.id = nhs.entity_id
         LEFT JOIN councils c ON e.id = c.entity_id
         LEFT JOIN government_departments gd ON e.id = gd.entity_id
         WHERE (e.name IS NULL OR e.name NOT IN ${PARENT_ORG_FILTER}) ${dateFilter} ${typeFilter}) as total_spend
    `)
      ),

      // 2. Main buyer data with optimized top supplier fetch using LATERAL JOIN
      // ... (rest of the query)
      db.execute(
        search
          ? sql`
          WITH filtered_buyers AS (
            SELECT 
              b.id,
              b.name as buyer_name,
              e.name as entity_name,
              b.entity_id,
              CASE 
                WHEN nhs.org_sub_type IS NOT NULL THEN nhs.org_sub_type
                WHEN e.entity_type = 'council' THEN 'Council'
                WHEN gd.entity_id IS NOT NULL THEN 'Government Dept'
                WHEN e.entity_type LIKE 'nhs_%' THEN 'NHS'
                ELSE 'NHS'
              END as display_type,
              nhs.ods_code,
              COALESCE(SUM(se.amount), 0) as total_spend,
              COUNT(DISTINCT se.raw_supplier) as supplier_count
            FROM buyers b
            LEFT JOIN entities e ON b.entity_id = e.id
            LEFT JOIN nhs_organisations nhs ON e.id = nhs.entity_id
            LEFT JOIN councils c ON e.id = c.entity_id
            LEFT JOIN government_departments gd ON e.id = gd.entity_id
            LEFT JOIN spend_entries se ON b.id = se.buyer_id ${sql.raw(
              dateFilter
            )}
            WHERE (b.name ILIKE ${"%" + search + "%"} OR e.name ILIKE ${
              "%" + search + "%"
            })
              AND (e.name IS NULL OR e.name NOT IN ('Department of Health and Social Care', 'DHSC', 'NHS England', 'NHS Business Services Authority'))
              ${sql.raw(typeFilter)}
            GROUP BY b.id, b.name, e.name, b.entity_id, nhs.org_sub_type, nhs.ods_code, e.entity_type, gd.entity_id
            HAVING COALESCE(SUM(se.amount), 0) > 0
            ORDER BY total_spend DESC
            LIMIT ${limit} OFFSET ${offset}
          )
          SELECT fb.*, ts.top_supplier, ts.top_supplier_id
          FROM filtered_buyers fb
          LEFT JOIN LATERAL (
            SELECT se2.raw_supplier as top_supplier, se2.supplier_id as top_supplier_id
            FROM spend_entries se2
            WHERE se2.buyer_id = fb.id ${sql.raw(dateFilterForSubquery)}
            GROUP BY se2.raw_supplier, se2.supplier_id
            ORDER BY SUM(se2.amount) DESC
            LIMIT 1
          ) ts ON true
        `
          : sql.raw(`
          WITH filtered_buyers AS (
            SELECT 
              b.id,
              b.name as buyer_name,
              e.name as entity_name,
              b.entity_id,
              CASE 
                WHEN nhs.org_sub_type IS NOT NULL THEN nhs.org_sub_type
                WHEN e.entity_type = 'council' THEN 'Council'
                WHEN gd.entity_id IS NOT NULL THEN 'Government Dept'
                WHEN e.entity_type LIKE 'nhs_%' THEN 'NHS'
                ELSE 'NHS'
              END as display_type,
              nhs.ods_code,
              COALESCE(SUM(se.amount), 0) as total_spend,
              COUNT(DISTINCT se.raw_supplier) as supplier_count
            FROM buyers b
            LEFT JOIN entities e ON b.entity_id = e.id
            LEFT JOIN nhs_organisations nhs ON e.id = nhs.entity_id
            LEFT JOIN councils c ON e.id = c.entity_id
            LEFT JOIN government_departments gd ON e.id = gd.entity_id
            LEFT JOIN spend_entries se ON b.id = se.buyer_id ${dateFilter}
            WHERE (e.name IS NULL OR e.name NOT IN ${PARENT_ORG_FILTER})
            ${typeFilter}
            GROUP BY b.id, b.name, e.name, b.entity_id, nhs.org_sub_type, nhs.ods_code, e.entity_type, gd.entity_id
            HAVING COALESCE(SUM(se.amount), 0) > 0
            ORDER BY total_spend DESC
            LIMIT ${limit} OFFSET ${offset}
          )
          SELECT fb.*, ts.top_supplier, ts.top_supplier_id
          FROM filtered_buyers fb
          LEFT JOIN LATERAL (
            SELECT se2.raw_supplier as top_supplier, se2.supplier_id as top_supplier_id
            FROM spend_entries se2
            WHERE se2.buyer_id = fb.id ${dateFilterForSubquery}
            GROUP BY se2.raw_supplier, se2.supplier_id
            ORDER BY SUM(se2.amount) DESC
            LIMIT 1
          ) ts ON true
        `)
      ),

      // 4. Total count for pagination
      db.execute(
        search
          ? sql`
            SELECT COUNT(DISTINCT b.id) as count
            FROM buyers b
            LEFT JOIN entities e ON b.entity_id = e.id
            LEFT JOIN nhs_organisations nhs ON e.id = nhs.entity_id
            LEFT JOIN councils c ON e.id = c.entity_id
            LEFT JOIN government_departments gd ON e.id = gd.entity_id
            INNER JOIN spend_entries se ON b.id = se.buyer_id ${sql.raw(
              dateFilter
            )}
            WHERE (b.name ILIKE ${"%" + search + "%"} OR e.name ILIKE ${
              "%" + search + "%"
            })
              AND (e.name IS NULL OR e.name NOT IN ('Department of Health and Social Care', 'DHSC', 'NHS England', 'NHS Business Services Authority'))
              ${sql.raw(typeFilter)}
          `
          : sql.raw(`
            SELECT COUNT(DISTINCT b.id) as count
            FROM buyers b
            LEFT JOIN entities e ON b.entity_id = e.id
            LEFT JOIN nhs_organisations nhs ON e.id = nhs.entity_id
            LEFT JOIN councils c ON e.id = c.entity_id
            LEFT JOIN government_departments gd ON e.id = gd.entity_id
            INNER JOIN spend_entries se ON b.id = se.buyer_id ${dateFilter}
            WHERE (e.name IS NULL OR e.name NOT IN ${PARENT_ORG_FILTER})
            ${typeFilter}
          `)
      ),

      // 5. Stats by buyer type
      db.execute(
        sql.raw(`
      SELECT 
        CASE 
          WHEN nhs.entity_id IS NOT NULL OR e.entity_type LIKE 'nhs_%' THEN 'NHS Orgs'
          WHEN c.entity_id IS NOT NULL OR e.entity_type = 'council' THEN 'Councils'
          WHEN gd.entity_id IS NOT NULL THEN 'Government Departments'
          ELSE 'NHS Orgs' -- Default to NHS Orgs for unmatched entries in this context
        END as type,
        COUNT(DISTINCT b.id) as buyer_count,
        SUM(se.amount) as total_spend
      FROM buyers b
      LEFT JOIN entities e ON b.entity_id = e.id
      LEFT JOIN nhs_organisations nhs ON e.id = nhs.entity_id
      LEFT JOIN councils c ON e.id = c.entity_id
      LEFT JOIN government_departments gd ON e.id = gd.entity_id
      JOIN spend_entries se ON b.id = se.buyer_id ${dateFilter}
      WHERE (e.name IS NULL OR e.name NOT IN ${PARENT_ORG_FILTER}) ${typeFilter}
      GROUP BY 1
      ORDER BY total_spend DESC
    `)
      ),

      // 6. Parent organisations
      db.execute(
        sql.raw(`
      SELECT 
        b.id,
        b.name,
        COALESCE(SUM(se.amount), 0) as total_spend,
        COUNT(DISTINCT se.raw_supplier) as supplier_count
      FROM buyers b
      LEFT JOIN entities e ON b.entity_id = e.id
      LEFT JOIN spend_entries se ON b.id = se.buyer_id ${dateFilter}
      WHERE (e.name IN ${PARENT_ORG_FILTER} OR b.name IN ${PARENT_ORG_FILTER})
      GROUP BY b.id, b.name
      ORDER BY total_spend DESC
    `)
      ),
    ]);

  const summaryResult = summaryRes.rows[0] as any;
  const countResult = countRes.rows[0] as any;

  return {
    summary: {
      totalBuyers: Number(summaryResult?.total_buyers) || 0,
      activeLast90Days: Number(summaryResult?.active_last_90_days) || 0,
      totalSpend: Number(summaryResult?.total_spend) || 0,
    },
    typeStats: typeStatsRes.rows as any[],
    parentOrganisations: parentOrgsRes.rows as any[],
    buyers: buyersRes.rows as any[],
    pagination: {
      page,
      limit,
      total: Number(countResult?.count) || 0,
      totalPages: Math.ceil(Number(countResult?.count) / limit),
    },
  };
}
