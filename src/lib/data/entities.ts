import { db } from "@/db";
import { sql, eq, count, ilike, and, desc, asc } from "drizzle-orm";
import { entities, suppliers, spendEntries, buyers } from "@/db/schema";
import { refreshAISummary } from "@/lib/ai-summary";

export interface EntitySummary {
  totalSpend: number;
  transactionCount: number;
  buyerCount: number;
  earliestDate: string | null;
  latestDate: string | null;
}

export interface EntityWithStats {
  id: number;
  name: string;
  entityType: string;
  registryId: string;
  locality: string | null;
  postalCode: string | null;
  buyerTotalSpend: number;
  supplierTotalReceived: number;
  supplierCount: number;
  buyerCount: number;
}

export interface EntitiesListResponse {
  entities: EntityWithStats[];
  totalCount: number;
  countsByType: {
    total: number;
    company: number;
    nhs: number;
    council: number;
    government_department: number;
  };
  limit: number;
  offset: number;
}

export async function getEntities(options: {
  limit?: number;
  offset?: number;
  search?: string;
  type?: string;
  sort?: "buyerTotalSpend" | "supplierTotalReceived";
  order?: "asc" | "desc";
}): Promise<EntitiesListResponse> {
  const {
    limit = 20,
    offset = 0,
    search,
    type,
    sort = "supplierTotalReceived",
    order = "desc",
  } = options;

  const filters = [];
  if (type && type !== "all") {
    if (type === "nhs") {
      filters.push(ilike(entities.entityType, "nhs_%"));
    } else {
      filters.push(eq(entities.entityType, type));
    }
  }
  if (search) {
    filters.push(ilike(entities.name, `%${search}%`));
  }

  const searchFilter = search ? ilike(entities.name, `%${search}%`) : undefined;

  // Optimized: Combine summary counts into a single query
  const countsPromise = db
    .select({
      total: sql<number>`count(*)`,
      company: sql<number>`count(*) filter (where ${entities.entityType} = 'company')`,
      nhs: sql<number>`count(*) filter (where ${entities.entityType} ilike 'nhs_%')`,
      council: sql<number>`count(*) filter (where ${entities.entityType} = 'council')`,
      government_department: sql<number>`count(*) filter (where ${entities.entityType} = 'government_department')`,
    })
    .from(entities)
    .where(searchFilter);

  // Linked suppliers per entity (cheap; no spend_entries join)
  const supplierStats = db
    .select({
      entityId: suppliers.entityId,
      supplierCount: sql<number>`count(*)`.as("supplier_count"),
    })
    .from(suppliers)
    .innerJoin(entities, eq(suppliers.entityId, entities.id))
    .where(and(sql`${suppliers.entityId} IS NOT NULL`, ...filters))
    .groupBy(suppliers.entityId)
    .as("supplier_stats");

  // Get buyer counts per entity, also filtered
  const buyerStats = db
    .select({
      entityId: buyers.entityId,
      buyerCount: sql<number>`count(*)`.as("buyer_count"),
    })
    .from(buyers)
    .innerJoin(entities, eq(buyers.entityId, entities.id))
    .where(and(
      sql`${buyers.entityId} IS NOT NULL`,
      ...filters
    ))
    .groupBy(buyers.entityId)
    .as("buyer_stats");

  let mainQuery = db
    .select({
      id: entities.id,
      name: entities.name,
      entityType: entities.entityType,
      registryId: entities.registryId,
      locality: entities.locality,
      postalCode: entities.postalCode,
      buyerTotalSpend: entities.buyerTotalSpend,
      supplierTotalReceived: entities.supplierTotalReceived,
      supplierCount: supplierStats.supplierCount,
      buyerCount: buyerStats.buyerCount,
    })
    .from(entities)
    .leftJoin(supplierStats, eq(entities.id, supplierStats.entityId))
    .leftJoin(buyerStats, eq(entities.id, buyerStats.entityId))
    .where(and(...filters))
    .$dynamic();

  // Total count for pagination
  const totalCountPromise = db
    .select({ count: count() })
    .from(entities)
    .where(and(...filters));

  const [entitiesRows, totalCountResult, countsRes] = await Promise.all([
    mainQuery
      .orderBy(
        sort === "buyerTotalSpend"
          ? order === "desc"
            ? desc(entities.buyerTotalSpend)
            : asc(entities.buyerTotalSpend)
          : order === "desc"
          ? desc(entities.supplierTotalReceived)
          : asc(entities.supplierTotalReceived)
      )
      .limit(limit)
      .offset(offset),
    totalCountPromise,
    countsPromise,
  ]);

  const counts = countsRes[0] || { total: 0, company: 0, nhs: 0, council: 0, government_department: 0 };

  return {
    entities: entitiesRows.map(row => ({
      ...row,
      supplierCount: Number(row.supplierCount || 0),
      buyerCount: Number(row.buyerCount || 0),
      buyerTotalSpend: Number(row.buyerTotalSpend || 0),
      supplierTotalReceived: Number(row.supplierTotalReceived || 0),
    })),
    totalCount: totalCountResult[0]?.count || 0,
    countsByType: {
      total: Number(counts.total),
      company: Number(counts.company),
      nhs: Number(counts.nhs),
      council: Number(counts.council),
      government_department: Number(counts.government_department),
    },
    limit,
    offset,
  };
}

export interface EntityBuyer {
  id: number;
  name: string;
  displayType: string | null;
  totalSpend: number;
  transactionCount: number;
}

export interface EntityMonthlySpend {
  month: string;
  totalSpend: number;
  transactionCount: number;
}

export interface EntityTransaction {
  id: number;
  buyer_id: number;
  buyer: string;
  buyer_entity_id: number | null;
  buyer_entity_name: string | null;
  amount: string;
  payment_date: string;
  supplier_name: string;
  asset_id: number;
  source_sheet: string;
  source_row_number: number;
  original_name: string;
  run_id: number | null;
}

export interface EntityLinkedSupplier {
  id: number;
  name: string;
}

export interface EntityDetails {
  id: number;
  entity_type: string;
  name: string;
  registry_id: string;
  address_line_1: string | null;
  locality: string | null;
  postal_code: string | null;
  companyDetails?: {
    company_number: string;
    company_status: string;
    company_type: string;
    date_of_creation: string;
    sic_codes: string[] | null;
  };
  councilDetails?: {
    gss_code: string;
    council_type: string;
    region: string;
    nation: string;
  };
  nhsDetails?: {
    ods_code: string;
    org_type: string;
    org_sub_type: string;
    region: string;
  };
}

export async function getEntityData(id: number, options: {
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
  view?: "supplier" | "buyer";
}) {
  const { startDate = "", endDate = "", page = 1, limit = 50, view = "supplier" } = options;
  const offset = (page - 1) * limit;

  const isAllTime = !startDate && !endDate;
  const dateFilter =
    startDate && endDate
      ? `AND se.payment_date >= '${startDate}' AND se.payment_date <= '${endDate}'`
      : "";

  // Get entity info
  const entityRes = await db.execute(sql.raw(`
    SELECT id, entity_type, name, registry_id, address_line_1, locality, postal_code,
           ai_summary, ai_news, ai_summary_updated_at,
           buyer_total_spend, supplier_total_received
    FROM entities 
    WHERE id = ${id}
  `));

  let entity = entityRes.rows[0] as any;
  if (!entity) return null;

  const cachedBuyerTotalSpend = parseFloat(entity.buyer_total_spend) || 0;
  const cachedSupplierTotalReceived = parseFloat(entity.supplier_total_received) || 0;

  // We no longer await refreshAISummary here to avoid delaying the page load.
  // Instead, the client will fetch the AI summary separately.

  // Get all supplier IDs linked to this entity
  const suppliersRes = await db.execute(sql.raw(`
    SELECT id, name FROM suppliers WHERE entity_id = ${id}
  `));
  const linkedSuppliers = suppliersRes.rows as any[];
  const supplierIds = linkedSuppliers.map(s => s.id);

  // Get all buyer IDs linked to this entity
  const buyersRes = await db.execute(sql.raw(`
    SELECT id, name FROM buyers WHERE entity_id = ${id}
  `));
  const linkedBuyers = buyersRes.rows as any[];
  const buyerIds = linkedBuyers.map(b => b.id);

  // Determine whether each tab has data.
  // Prefer the cached totals (fast), and only fall back to COUNT queries when totals are 0.
  let hasSupplierData = supplierIds.length > 0 && cachedSupplierTotalReceived > 0;
  let hasBuyerData = buyerIds.length > 0 && cachedBuyerTotalSpend > 0;

  if (!hasSupplierData && supplierIds.length > 0) {
    const supplierCountRes = await db.execute(sql.raw(`
      SELECT COUNT(*) as count FROM spend_entries WHERE supplier_id IN (${supplierIds.join(",")})
    `));
    hasSupplierData = parseInt((supplierCountRes.rows[0] as any).count) > 0;
  }

  if (!hasBuyerData && buyerIds.length > 0) {
    const buyerCountRes = await db.execute(sql.raw(`
      SELECT COUNT(*) as count FROM spend_entries WHERE buyer_id IN (${buyerIds.join(",")})
    `));
    hasBuyerData = parseInt((buyerCountRes.rows[0] as any).count) > 0;
  }

  // Decide which data to fetch based on view
  // If no view is provided, default to the one that has data
  let activeView = options.view;
  if (!activeView) {
    activeView = hasSupplierData ? "supplier" : (hasBuyerData ? "buyer" : "supplier");
  }

  const activeIds = activeView === "supplier" ? supplierIds : buyerIds;
  const idField = activeView === "supplier" ? "supplier_id" : "buyer_id";
  const otherIdField = activeView === "supplier" ? "buyer_id" : "supplier_id";
  const otherTable = activeView === "supplier" ? "buyers" : "suppliers";

  if (activeIds.length === 0) {
    return {
      entity,
      linkedSuppliers,
      linkedBuyers,
      hasSupplierData,
      hasBuyerData,
      summary: { totalSpend: 0, transactionCount: 0, buyerCount: 0, supplierCount: 0, earliestDate: null, latestDate: null },
      topCounterparts: [],
      monthlySpend: [],
      topTransactions: [],
      transactions: [],
      pagination: { page, limit, total: 0, totalPages: 0 }
    };
  }

  const idList = activeIds.join(",");

  // Get summary stats
  const summaryRes = await db.execute(sql.raw(
    isAllTime
      ? `
        SELECT 
          0 as total_spend,
          COUNT(*) as transaction_count,
          COUNT(DISTINCT se.buyer_id) as buyer_count,
          COUNT(DISTINCT se.supplier_id) as supplier_count,
          MIN(se.payment_date) as earliest_date,
          MAX(se.payment_date) as latest_date
        FROM spend_entries se
        WHERE se.${idField} IN (${idList})
      `
      : `
        SELECT 
          COALESCE(SUM(se.amount), 0) as total_spend,
          COUNT(*) as transaction_count,
          COUNT(DISTINCT se.buyer_id) as buyer_count,
          COUNT(DISTINCT se.supplier_id) as supplier_count,
          MIN(se.payment_date) as earliest_date,
          MAX(se.payment_date) as latest_date
        FROM spend_entries se
        WHERE se.${idField} IN (${idList})
        ${dateFilter}
      `
  ));

  const summaryData = summaryRes.rows[0] as any;

  // Get top counterparts (buyers if we are supplier, suppliers if we are buyer)
  const topCounterpartsRes = await db.execute(sql.raw(`
    SELECT 
      target.id,
      target.name,
      ${view === "supplier" ? `
      CASE 
        WHEN nhs.org_sub_type IS NOT NULL THEN nhs.org_sub_type
        WHEN e.entity_type = 'council' THEN 'Council'
        WHEN gd.entity_id IS NOT NULL THEN 'Government Dept'
        WHEN e.entity_type LIKE 'nhs_%' THEN 'NHS'
        ELSE 'NHS'
      END as display_type,` : ""}
      SUM(se.amount) as total_spend,
      COUNT(*) as transaction_count
    FROM spend_entries se
    JOIN ${otherTable} target ON target.id = se.${otherIdField}
    ${view === "supplier" ? `
    LEFT JOIN entities e ON e.id = target.entity_id
    LEFT JOIN nhs_organisations nhs ON nhs.entity_id = e.id
    LEFT JOIN government_departments gd ON gd.entity_id = e.id
    ` : ""}
    WHERE se.${idField} IN (${idList})
    ${dateFilter}
    GROUP BY target.id, target.name ${view === "supplier" ? ", nhs.org_sub_type, e.entity_type, gd.entity_id" : ""}
    ORDER BY total_spend DESC
    LIMIT 10
  `));

  // Get monthly spend
  const monthlySpendRes = await db.execute(sql.raw(`
    SELECT 
      DATE_TRUNC('month', se.payment_date) as month,
      SUM(se.amount) as total_spend,
      COUNT(*) as transaction_count
    FROM spend_entries se
    WHERE se.${idField} IN (${idList})
    ${dateFilter}
    GROUP BY DATE_TRUNC('month', se.payment_date)
    ORDER BY month DESC
    LIMIT 24
  `));

  // Get top transactions
  const topTransactionsRes = await db.execute(sql.raw(`
    SELECT 
      se.id,
      b.id as buyer_id,
      b.name as buyer,
      be.id as buyer_entity_id,
      be.name as buyer_entity_name,
      se.amount,
      se.payment_date,
      s.id as supplier_id,
      s.name as supplier_name,
      se.asset_id,
      se.source_sheet,
      se.source_row_number,
      pa.original_name,
      se_entity.id as supplier_entity_id,
      se_entity.name as supplier_entity_name,
      (SELECT pr.id FROM pipeline_runs pr WHERE pr.asset_id = se.asset_id AND pr.status = 'succeeded' ORDER BY pr.finished_at DESC LIMIT 1) as run_id
    FROM spend_entries se
    JOIN buyers b ON b.id = se.buyer_id
    LEFT JOIN entities be ON be.id = b.entity_id
    JOIN suppliers s ON s.id = se.supplier_id
    LEFT JOIN entities se_entity ON se_entity.id = s.entity_id
    JOIN pipeline_assets pa ON pa.id = se.asset_id
    WHERE se.${idField} IN (${idList})
    ${dateFilter}
    ORDER BY se.amount DESC
    LIMIT 10
  `));

  // Get paginated transactions
  const transactionsRes = await db.execute(sql.raw(`
    SELECT 
      se.id,
      b.id as buyer_id,
      b.name as buyer,
      be.id as buyer_entity_id,
      be.name as buyer_entity_name,
      se.amount,
      se.payment_date,
      s.id as supplier_id,
      s.name as supplier_name,
      se.asset_id,
      se.source_sheet,
      se.source_row_number,
      pa.original_name,
      se_entity.id as supplier_entity_id,
      se_entity.name as supplier_entity_name,
      (SELECT pr.id FROM pipeline_runs pr WHERE pr.asset_id = se.asset_id AND pr.status = 'succeeded' ORDER BY pr.finished_at DESC LIMIT 1) as run_id
    FROM spend_entries se
    JOIN buyers b ON b.id = se.buyer_id
    LEFT JOIN entities be ON be.id = b.entity_id
    JOIN suppliers s ON s.id = se.supplier_id
    LEFT JOIN entities se_entity ON se_entity.id = s.entity_id
    JOIN pipeline_assets pa ON pa.id = se.asset_id
    WHERE se.${idField} IN (${idList})
    ${dateFilter}
    ORDER BY se.payment_date DESC, se.amount DESC
    LIMIT ${limit} OFFSET ${offset}
  `));

  // Get total count
  const countRes = await db.execute(sql.raw(`
    SELECT COUNT(*) as count
    FROM spend_entries se
    WHERE se.${idField} IN (${idList})
    ${dateFilter}
  `));

  const totalCount = parseInt((countRes.rows[0] as any).count) || 0;

  // Entity details based on type
  let companyDetails = null;
  let councilDetails = null;
  let nhsDetails = null;

  if (entity.entity_type === "company") {
    const res = await db.execute(sql.raw(`
      SELECT company_number, company_status, company_type, date_of_creation, sic_codes
      FROM companies WHERE entity_id = ${id}
    `));
    companyDetails = res.rows[0];
  } else if (entity.entity_type === "council") {
    const res = await db.execute(sql.raw(`
      SELECT gss_code, council_type, region, nation
      FROM councils WHERE entity_id = ${id}
    `));
    councilDetails = res.rows[0];
  } else if (entity.entity_type.startsWith("nhs_")) {
    const res = await db.execute(sql.raw(`
      SELECT ods_code, org_type, org_sub_type, region
      FROM nhs_organisations WHERE entity_id = ${id}
    `));
    nhsDetails = res.rows[0];
  }

  return {
    entity: {
      ...entity,
      companyDetails,
      councilDetails,
      nhsDetails,
    },
    activeView,
    linkedSuppliers,
    linkedBuyers,
    hasSupplierData,
    hasBuyerData,
    summary: {
      totalSpend: isAllTime
        ? activeView === "supplier"
          ? cachedSupplierTotalReceived
          : cachedBuyerTotalSpend
        : parseFloat(summaryData.total_spend) || 0,
      transactionCount: parseInt(summaryData.transaction_count) || 0,
      buyerCount: parseInt(summaryData.buyer_count) || 0,
      supplierCount: parseInt(summaryData.supplier_count) || 0,
      earliestDate: summaryData.earliest_date,
      latestDate: summaryData.latest_date,
    },
    topCounterparts: (topCounterpartsRes.rows as any[]).map((b) => ({
      id: b.id,
      name: b.name,
      displayType: b.display_type || null,
      totalSpend: parseFloat(b.total_spend) || 0,
      transactionCount: parseInt(b.transaction_count) || 0,
    })),
    monthlySpend: (monthlySpendRes.rows as any[]).map((m) => ({
      month: m.month,
      totalSpend: parseFloat(m.total_spend) || 0,
      transactionCount: parseInt(m.transaction_count) || 0,
    })),
    topTransactions: topTransactionsRes.rows as any[],
    transactions: transactionsRes.rows as any[],
    pagination: {
      page,
      limit,
      total: totalCount,
      totalPages: Math.ceil(totalCount / limit),
    },
  };
}

