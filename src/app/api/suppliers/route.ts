import { db } from "@/db";
import { suppliers, entities, companies, spendEntries } from "@/db/schema";
import { eq, sql, desc, count } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const limit = Math.min(100, parseInt(searchParams.get("limit") || "20"));
  const offset = parseInt(searchParams.get("offset") || "0");
  const sort = searchParams.get("sort") || "totalSpend";
  const order = searchParams.get("order") || "desc";
  const status = searchParams.get("status");

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

    let query = db
      .select({
        id: suppliers.id,
        name: suppliers.name,
        matchStatus: suppliers.matchStatus,
        matchConfidence: suppliers.matchConfidence,
        entityId: suppliers.entityId,
        entityName: entities.name,
        entityType: entities.entityType,
        companyNumber: companies.companyNumber,
        totalSpend: statsQuery.totalSpend,
        transactionCount: statsQuery.transactionCount,
      })
      .from(suppliers)
      .leftJoin(entities, eq(suppliers.entityId, entities.id))
      .leftJoin(companies, eq(entities.id, companies.entityId))
      .leftJoin(statsQuery, eq(suppliers.id, statsQuery.supplierId));

    if (status) {
      // @ts-ignore - drizzle orm typing can be tricky with dynamic queries
      query = query.where(eq(suppliers.matchStatus, status));
    }

    const rows = await query
      .orderBy(order === "desc" ? desc(statsQuery.totalSpend) : statsQuery.totalSpend)
      .limit(limit)
      .offset(offset);

    const totalCountResult = await db.select({ count: count() }).from(suppliers);
    const totalCount = totalCountResult[0]?.count || 0;

    const matchedCountResult = await db
      .select({ count: count() })
      .from(suppliers)
      .where(eq(suppliers.matchStatus, "matched"));
    const matchedCount = matchedCountResult[0]?.count || 0;

    const pendingCountResult = await db
      .select({ count: count() })
      .from(suppliers)
      .where(eq(suppliers.matchStatus, "pending"));
    const pendingCount = pendingCountResult[0]?.count || 0;

    return NextResponse.json({ 
      suppliers: rows,
      totalCount,
      matchedCount,
      pendingCount,
      limit,
      offset
    });
  } catch (error) {
    console.error("Error fetching suppliers:", error);
    return NextResponse.json({ error: "Failed to fetch suppliers" }, { status: 500 });
  }
}
