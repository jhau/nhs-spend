import { db } from "@/db";
import { sql } from "drizzle-orm";

export interface EntitySummary {
  totalSpend: number;
  transactionCount: number;
  buyerCount: number;
  earliestDate: string | null;
  latestDate: string | null;
}

export interface EntityBuyer {
  id: number;
  name: string;
  trustType: string | null;
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
}) {
  const { startDate = "", endDate = "", page = 1, limit = 50 } = options;
  const offset = (page - 1) * limit;

  const dateFilter =
    startDate && endDate
      ? `AND se.payment_date >= '${startDate}' AND se.payment_date <= '${endDate}'`
      : "";

  // Get entity info
  const entityRes = await db.execute(sql.raw(`
    SELECT id, entity_type, name, registry_id, address_line_1, locality, postal_code 
    FROM entities 
    WHERE id = ${id}
  `));

  const entity = entityRes.rows[0] as any;
  if (!entity) return null;

  // Get all supplier IDs linked to this entity
  const suppliersRes = await db.execute(sql.raw(`
    SELECT id, name FROM suppliers WHERE entity_id = ${id}
  `));
  const linkedSuppliers = suppliersRes.rows as any[];
  const supplierIds = linkedSuppliers.map(s => s.id);

  if (supplierIds.length === 0) {
    return {
      entity,
      linkedSuppliers: [],
      summary: { totalSpend: 0, transactionCount: 0, buyerCount: 0, earliestDate: null, latestDate: null },
      topBuyers: [],
      monthlySpend: [],
      topTransactions: [],
      transactions: [],
      pagination: { page, limit, total: 0, totalPages: 0 }
    };
  }

  const supplierIdList = supplierIds.join(",");

  // Get summary stats for all suppliers of this entity
  const summaryRes = await db.execute(sql.raw(`
    SELECT 
      COALESCE(SUM(se.amount), 0) as total_spend,
      COUNT(*) as transaction_count,
      COUNT(DISTINCT se.organisation_id) as buyer_count,
      MIN(se.payment_date) as earliest_date,
      MAX(se.payment_date) as latest_date
    FROM spend_entries se
    WHERE se.supplier_id IN (${supplierIdList})
    ${dateFilter}
  `));

  const summary = summaryRes.rows[0] as any;

  // Get top buyers
  const topBuyersRes = await db.execute(sql.raw(`
    SELECT 
      o.id,
      e.name,
      nhs.org_sub_type as trust_type,
      SUM(se.amount) as total_spend,
      COUNT(*) as transaction_count
    FROM spend_entries se
    JOIN organisations o ON o.id = se.organisation_id
    JOIN entities e ON e.id = o.entity_id
    LEFT JOIN nhs_organisations nhs ON nhs.entity_id = e.id
    WHERE se.supplier_id IN (${supplierIdList})
    ${dateFilter}
    GROUP BY o.id, e.name, nhs.org_sub_type
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
    WHERE se.supplier_id IN (${supplierIdList})
    ${dateFilter}
    GROUP BY DATE_TRUNC('month', se.payment_date)
    ORDER BY month DESC
    LIMIT 24
  `));

  // Get top transactions
  const topTransactionsRes = await db.execute(sql.raw(`
    SELECT 
      se.id,
      o.id as buyer_id,
      e.name as buyer,
      se.amount,
      se.payment_date,
      s.name as supplier_name,
      se.asset_id,
      se.source_sheet,
      se.source_row_number,
      pa.original_name,
      (SELECT pr.id FROM pipeline_runs pr WHERE pr.asset_id = se.asset_id AND pr.status = 'succeeded' ORDER BY pr.finished_at DESC LIMIT 1) as run_id
    FROM spend_entries se
    JOIN organisations o ON o.id = se.organisation_id
    JOIN entities e ON e.id = o.entity_id
    JOIN suppliers s ON s.id = se.supplier_id
    JOIN pipeline_assets pa ON pa.id = se.asset_id
    WHERE se.supplier_id IN (${supplierIdList})
    ${dateFilter}
    ORDER BY se.amount DESC
    LIMIT 10
  `));

  // Get paginated transactions
  const transactionsRes = await db.execute(sql.raw(`
    SELECT 
      se.id,
      o.id as buyer_id,
      e.name as buyer,
      se.amount,
      se.payment_date,
      s.name as supplier_name,
      se.asset_id,
      se.source_sheet,
      se.source_row_number,
      pa.original_name,
      (SELECT pr.id FROM pipeline_runs pr WHERE pr.asset_id = se.asset_id AND pr.status = 'succeeded' ORDER BY pr.finished_at DESC LIMIT 1) as run_id
    FROM spend_entries se
    JOIN organisations o ON o.id = se.organisation_id
    JOIN entities e ON e.id = o.entity_id
    JOIN suppliers s ON s.id = se.supplier_id
    JOIN pipeline_assets pa ON pa.id = se.asset_id
    WHERE se.supplier_id IN (${supplierIdList})
    ${dateFilter}
    ORDER BY se.payment_date DESC, se.amount DESC
    LIMIT ${limit} OFFSET ${offset}
  `));

  // Get total count
  const countRes = await db.execute(sql.raw(`
    SELECT COUNT(*) as count
    FROM spend_entries se
    WHERE se.supplier_id IN (${supplierIdList})
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
    linkedSuppliers,
    summary: {
      totalSpend: parseFloat(summary.total_spend) || 0,
      transactionCount: parseInt(summary.transaction_count) || 0,
      buyerCount: parseInt(summary.buyer_count) || 0,
      earliestDate: summary.earliest_date,
      latestDate: summary.latest_date,
    },
    topBuyers: (topBuyersRes.rows as any[]).map((b) => ({
      id: b.id,
      name: b.name,
      trustType: b.trust_type,
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

