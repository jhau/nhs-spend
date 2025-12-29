import { db } from "@/db";
import { suppliers, companies, spendEntries } from "@/db/schema";
import { eq, sql, desc, count } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const limit = Math.min(100, parseInt(searchParams.get("limit") || "20"));
  const offset = parseInt(searchParams.get("offset") || "0");
  const sort = searchParams.get("sort") || "totalSpend";
  const order = searchParams.get("order") || "desc";

  try {
    // We want to list suppliers with their total spend and transaction count
    const statsQuery = db
      .select({
        supplierId: spendEntries.supplierId,
        totalSpend: sql<number>`sum(${spendEntries.amount})`.as("total_spend"),
        transactionCount: sql<number>`count(*)`.as("transaction_count"),
      })
      .from(spendEntries)
      .groupBy(spendEntries.supplierId)
      .as("stats");

    const rows = await db
      .select({
        id: suppliers.id,
        name: suppliers.name,
        matchStatus: suppliers.matchStatus,
        matchConfidence: suppliers.matchConfidence,
        companyId: suppliers.companyId,
        companyName: companies.companyName,
        companyNumber: companies.companyNumber,
        totalSpend: statsQuery.totalSpend,
        transactionCount: statsQuery.transactionCount,
      })
      .from(suppliers)
      .leftJoin(companies, eq(suppliers.companyId, companies.id))
      .leftJoin(statsQuery, eq(suppliers.id, statsQuery.supplierId))
      .orderBy(order === "desc" ? desc(statsQuery.totalSpend) : statsQuery.totalSpend)
      .limit(limit)
      .offset(offset);

    const totalCountResult = await db.select({ count: count() }).from(suppliers);
    const totalCount = totalCountResult[0]?.count || 0;

    return NextResponse.json({ 
      suppliers: rows,
      totalCount,
      limit,
      offset
    });
  } catch (error) {
    console.error("Error fetching suppliers:", error);
    return NextResponse.json({ error: "Failed to fetch suppliers" }, { status: 500 });
  }
}

