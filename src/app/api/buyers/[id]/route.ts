import { db } from "@/db";
import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const buyerId = parseInt(id);

  if (isNaN(buyerId)) {
    return NextResponse.json({ error: "Invalid buyer ID" }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const startDate = searchParams.get("startDate") || "";
  const endDate = searchParams.get("endDate") || "";
  const excludeSuppliers = searchParams.get("excludeSuppliers") || "";
  const supplierName = searchParams.get("supplier") || "";
  const page = parseInt(searchParams.get("page") || "1");
  const limit = parseInt(searchParams.get("limit") || "50");
  const offset = (page - 1) * limit;

  const dateFilter =
    startDate && endDate
      ? `AND se.payment_date >= '${startDate}' AND se.payment_date <= '${endDate}'`
      : "";

  // Build supplier exclusion filter
  let supplierFilter = "";
  if (excludeSuppliers) {
    const suppliers = excludeSuppliers.split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
    if (suppliers.length > 0) {
      const conditions = suppliers.map(s => `LOWER(se.supplier) NOT LIKE '%${s.replace(/'/g, "''")}%'`).join(" AND ");
      supplierFilter = `AND (${conditions})`;
    }
  }

  // Build supplier name filter (for clicking on a specific supplier)
  let supplierNameFilter = "";
  if (supplierName) {
    supplierNameFilter = `AND se.supplier = '${supplierName.replace(/'/g, "''")}'`;
  }

  try {
    // Get buyer details with entity and NHS organisation info
    const buyerRes = await db.execute(sql.raw(`
      SELECT 
        b.id,
        b.name as buyer_name,
        e.name as entity_name,
        e.entity_type,
        e.registry_id,
        e.address_line_1,
        e.address_line_2,
        e.locality,
        e.postal_code as post_code,
        e.country,
        e.status as entity_status,
        e.latitude,
        e.longitude,
        CASE 
          WHEN nhs.org_sub_type IS NOT NULL THEN nhs.org_sub_type
          WHEN e.entity_type = 'council' THEN 'Council'
          WHEN gd.entity_id IS NOT NULL THEN 'Government Dept'
          WHEN e.entity_type LIKE 'nhs_%' THEN 'NHS'
          ELSE 'NHS'
        END as display_type,
        nhs.ods_code,
        nhs.parent_ods_code as icb_ods_code,
        b.match_status,
        b.match_confidence
      FROM buyers b
      LEFT JOIN entities e ON b.entity_id = e.id
      LEFT JOIN nhs_organisations nhs ON e.id = nhs.entity_id
      LEFT JOIN government_departments gd ON e.id = gd.entity_id
      WHERE b.id = ${buyerId}
    `));

    if (buyerRes.rows.length === 0) {
      return NextResponse.json({ error: "Buyer not found" }, { status: 404 });
    }

    const buyer = buyerRes.rows[0] as any;

    // Get summary stats
    const summaryRes = await db.execute(sql.raw(`
      SELECT 
        COALESCE(SUM(se.amount), 0) as total_spend,
        COUNT(*) as transaction_count,
        COUNT(DISTINCT se.raw_supplier) as supplier_count,
        MIN(se.payment_date) as earliest_date,
        MAX(se.payment_date) as latest_date
      FROM spend_entries se
      WHERE se.buyer_id = ${buyerId}
      ${dateFilter}
      ${supplierFilter}
    `));

    const summary = summaryRes.rows[0] as any;

    // Get top suppliers
    const topSuppliersRes = await db.execute(sql.raw(`
      SELECT 
        s.id as supplier_id,
        s.name as supplier,
        SUM(se.amount) as total_spend,
        COUNT(*) as transaction_count
      FROM spend_entries se
      JOIN suppliers s ON s.id = se.supplier_id
      WHERE se.buyer_id = ${buyerId}
      ${dateFilter}
      ${supplierFilter}
      GROUP BY s.id, s.name
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
      WHERE se.buyer_id = ${buyerId}
      ${dateFilter}
      ${supplierFilter}
      GROUP BY DATE_TRUNC('month', se.payment_date)
      ORDER BY month DESC
      LIMIT 24
    `));

    // Get top 10 transactions by amount
    const topTransactionsRes = await db.execute(sql.raw(`
      SELECT 
        se.id,
        s.id as supplier_id,
        s.name as supplier,
        se.amount,
        se.payment_date
      FROM spend_entries se
      JOIN suppliers s ON s.id = se.supplier_id
      WHERE se.buyer_id = ${buyerId}
      ${dateFilter}
      ${supplierFilter}
      ORDER BY se.amount DESC
      LIMIT 10
    `));

    // Get recent transactions
    const transactionsRes = await db.execute(sql.raw(`
      SELECT 
        se.id,
        s.id as supplier_id,
        s.name as supplier,
        se.amount,
        se.payment_date
      FROM spend_entries se
      JOIN suppliers s ON s.id = se.supplier_id
      WHERE se.buyer_id = ${buyerId}
      ${dateFilter}
      ${supplierFilter}
      ${supplierNameFilter}
      ORDER BY se.payment_date DESC, se.amount DESC
      LIMIT ${limit} OFFSET ${offset}
    `));

    // Get total count for pagination
    const countRes = await db.execute(sql.raw(`
      SELECT COUNT(*) as count
      FROM spend_entries se
      WHERE se.buyer_id = ${buyerId}
      ${dateFilter}
      ${supplierFilter}
      ${supplierNameFilter}
    `));

    const totalCount = parseInt((countRes.rows[0] as any).count) || 0;

    return NextResponse.json({
      buyer: {
        id: buyer.id,
        name: buyer.buyer_name,
        entityName: buyer.entity_name,
        entityType: buyer.entity_type,
        registryId: buyer.registry_id,
        addressLine1: buyer.address_line_1,
        addressLine2: buyer.address_line_2,
        locality: buyer.locality,
        postCode: buyer.post_code,
        country: buyer.country,
        entityStatus: buyer.entity_status,
        displayType: buyer.display_type,
        odsCode: buyer.ods_code,
        icbOdsCode: buyer.icb_ods_code,
        latitude: buyer.latitude,
        longitude: buyer.longitude,
        matchStatus: buyer.match_status,
        matchConfidence: buyer.match_confidence,
      },
      summary: {
        totalSpend: parseFloat(summary.total_spend) || 0,
        transactionCount: parseInt(summary.transaction_count) || 0,
        supplierCount: parseInt(summary.supplier_count) || 0,
        earliestDate: summary.earliest_date,
        latestDate: summary.latest_date,
      },
      topSuppliers: (topSuppliersRes.rows as any[]).map((s) => ({
        id: s.supplier_id,
        name: s.supplier,
        totalSpend: parseFloat(s.total_spend) || 0,
        transactionCount: parseInt(s.transaction_count) || 0,
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
    console.error("Error fetching buyer:", error);
    return NextResponse.json(
      { error: "Failed to fetch buyer data" },
      { status: 500 }
    );
  }
}
