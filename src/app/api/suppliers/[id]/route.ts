import { db } from "@/db";
import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supplierId = parseInt(id);

  if (isNaN(supplierId)) {
    return NextResponse.json({ error: "Invalid supplier ID" }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const startDate = searchParams.get("startDate") || "";
  const endDate = searchParams.get("endDate") || "";
  const page = parseInt(searchParams.get("page") || "1");
  const limit = parseInt(searchParams.get("limit") || "50");
  const offset = (page - 1) * limit;

  const dateFilter =
    startDate && endDate
      ? `AND se.payment_date >= '${startDate}' AND se.payment_date <= '${endDate}'`
      : "";

  try {
    // Get supplier ID and company link
    const supplierRes = await db.execute(sql.raw(`
      SELECT id, name, entity_id FROM suppliers 
      WHERE id = ${supplierId}
    `));

    const supplier = supplierRes.rows[0] as any;

    if (!supplier) {
      return NextResponse.json({ error: "Supplier not found" }, { status: 404 });
    }

    // Get summary stats for this supplier
    const summaryRes = await db.execute(sql.raw(`
      SELECT 
        COALESCE(SUM(se.amount), 0) as total_spend,
        COUNT(*) as transaction_count,
        COUNT(DISTINCT se.organisation_id) as buyer_count,
        MIN(se.payment_date) as earliest_date,
        MAX(se.payment_date) as latest_date
      FROM spend_entries se
      WHERE se.supplier_id = ${supplierId}
      ${dateFilter}
    `));

    const summary = summaryRes.rows[0] as any;

    if (parseInt(summary.transaction_count) === 0) {
      // This might happen if supplier exists but has no spend entries (unlikely given migration logic)
      // Or if date filter excludes all entries
    }

    // Get top buyers for this supplier
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
      WHERE se.supplier_id = ${supplierId}
      ${dateFilter}
      GROUP BY o.id, e.name, nhs.org_sub_type
      ORDER BY total_spend DESC
      LIMIT 10
    `));

    // Get spending by month
    const monthlySpendRes = await db.execute(sql.raw(`
      SELECT 
        DATE_TRUNC('month', se.payment_date) as month,
        SUM(se.amount) as total_spend,
        COUNT(*) as transaction_count
      FROM spend_entries se
      WHERE se.supplier_id = ${supplierId}
      ${dateFilter}
      GROUP BY DATE_TRUNC('month', se.payment_date)
      ORDER BY month DESC
      LIMIT 24
    `));

    // Get top 10 transactions by amount
    const topTransactionsRes = await db.execute(sql.raw(`
      SELECT 
        se.id,
        o.id as buyer_id,
        e.name as buyer,
        se.amount,
        se.payment_date,
        se.asset_id,
        se.source_sheet,
        se.source_row_number,
        pa.original_name,
        (SELECT pr.id FROM pipeline_runs pr WHERE pr.asset_id = se.asset_id AND pr.status = 'succeeded' ORDER BY pr.finished_at DESC LIMIT 1) as run_id
      FROM spend_entries se
      JOIN organisations o ON o.id = se.organisation_id
      JOIN entities e ON e.id = o.entity_id
      JOIN pipeline_assets pa ON pa.id = se.asset_id
      WHERE se.supplier_id = ${supplierId}
      ${dateFilter}
      ORDER BY se.amount DESC
      LIMIT 10
    `));

    // Get recent transactions with pagination
    const transactionsRes = await db.execute(sql.raw(`
      SELECT 
        se.id,
        o.id as buyer_id,
        e.name as buyer,
        se.amount,
        se.payment_date,
        se.asset_id,
        se.source_sheet,
        se.source_row_number,
        pa.original_name,
        (SELECT pr.id FROM pipeline_runs pr WHERE pr.asset_id = se.asset_id AND pr.status = 'succeeded' ORDER BY pr.finished_at DESC LIMIT 1) as run_id
      FROM spend_entries se
      JOIN organisations o ON o.id = se.organisation_id
      JOIN entities e ON e.id = o.entity_id
      JOIN pipeline_assets pa ON pa.id = se.asset_id
      WHERE se.supplier_id = ${supplierId}
      ${dateFilter}
      ORDER BY se.payment_date DESC, se.amount DESC
      LIMIT ${limit} OFFSET ${offset}
    `));

    // Get total count for pagination
    const countRes = await db.execute(sql.raw(`
      SELECT COUNT(*) as count
      FROM spend_entries se
      WHERE se.supplier_id = ${supplierId}
      ${dateFilter}
    `));

    const totalCount = parseInt((countRes.rows[0] as any).count) || 0;

    // Check if there's a linked entity (company or council)
    let linkedCompany = null;
    let linkedCouncil = null;
    
    if (supplier.entity_id) {
      const entityRes = await db.execute(sql.raw(`
        SELECT id, entity_type, name FROM entities WHERE id = ${supplier.entity_id}
      `));
      const entity = entityRes.rows[0] as any;

      if (entity?.entity_type === "company") {
        const companyRes = await db.execute(sql.raw(`
          SELECT 
            c.company_number,
            e.name as company_name,
            c.company_status,
            c.company_type,
            c.date_of_creation,
            e.address_line_1,
            e.locality,
            e.postal_code,
            c.sic_codes
          FROM companies c
          JOIN entities e ON e.id = c.entity_id
          WHERE c.entity_id = ${supplier.entity_id}
        `));
        linkedCompany = companyRes.rows[0];
      } else if (entity?.entity_type === "council") {
        const councilRes = await db.execute(sql.raw(`
          SELECT 
            co.gss_code,
            e.name as council_name,
            co.council_type,
            e.address_line_1,
            e.locality,
            e.postal_code
          FROM councils co
          JOIN entities e ON e.id = co.entity_id
          WHERE co.entity_id = ${supplier.entity_id}
        `));
        linkedCouncil = councilRes.rows[0];
      }
    }

    return NextResponse.json({
      supplier: {
        name: supplier.name,
        id: supplier.id,
        entity_id: supplier.entity_id,
      },
      linkedCompany: linkedCompany ? {
        companyNumber: (linkedCompany as any).company_number,
        companyName: (linkedCompany as any).company_name,
        companyStatus: (linkedCompany as any).company_status,
        companyType: (linkedCompany as any).company_type,
        dateOfCreation: (linkedCompany as any).date_of_creation,
        address: [
          (linkedCompany as any).address_line_1,
          (linkedCompany as any).locality,
          (linkedCompany as any).postal_code,
        ].filter(Boolean).join(", "),
        sicCodes: (linkedCompany as any).sic_codes,
      } : null,
      linkedCouncil: linkedCouncil ? {
        gssCode: (linkedCouncil as any).gss_code,
        councilName: (linkedCouncil as any).council_name,
        councilType: (linkedCouncil as any).council_type,
        address: [
          (linkedCouncil as any).address_line_1,
          (linkedCouncil as any).locality,
          (linkedCouncil as any).postal_code,
        ].filter(Boolean).join(", "),
      } : null,
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
      topTransactions: topTransactionsRes.rows,
      transactions: transactionsRes.rows,
      pagination: {
        page,
        limit,
        total: totalCount,
        totalPages: Math.ceil(totalCount / limit),
      },
    });
  } catch (error) {
    console.error("Error fetching supplier:", error);
    return NextResponse.json(
      { error: "Failed to fetch supplier data" },
      { status: 500 }
    );
  }
}
