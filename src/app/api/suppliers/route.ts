import { db } from "@/db";
import { suppliers, entities, companies, spendEntries } from "@/db/schema";
import { eq, sql, desc, count, ilike, and } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const limit = Math.min(100, parseInt(searchParams.get("limit") || "20"));
  const offset = parseInt(searchParams.get("offset") || "0");
  const sort = searchParams.get("sort") || "totalSpend";
  const order = searchParams.get("order") || "desc";
  const status = searchParams.get("status");
  const search = searchParams.get("search");

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
      .leftJoin(statsQuery, eq(suppliers.id, statsQuery.supplierId))
      .$dynamic();

    const filters = [];
    if (status) {
      filters.push(eq(suppliers.matchStatus, status));
    }
    if (search) {
      filters.push(ilike(suppliers.name, `%${search}%`));
    }

    if (filters.length > 0) {
      query = query.where(and(...filters));
    }

    const rows = await query
      .orderBy(order === "desc" ? desc(statsQuery.totalSpend) : statsQuery.totalSpend)
      .limit(limit)
      .offset(offset);

    const countFilters = [];
    if (search) {
      countFilters.push(ilike(suppliers.name, `%${search}%`));
    }

    let totalCountQuery = db.select({ count: count() }).from(suppliers).$dynamic();
    if (countFilters.length > 0) {
      totalCountQuery = totalCountQuery.where(and(...countFilters));
    }
    const totalCountResult = await totalCountQuery;
    const totalCount = totalCountResult[0]?.count || 0;

    let matchedCountQuery = db
      .select({ count: count() })
      .from(suppliers)
      .where(eq(suppliers.matchStatus, "matched"))
      .$dynamic();
    if (search) {
      matchedCountQuery = matchedCountQuery.where(and(eq(suppliers.matchStatus, "matched"), ilike(suppliers.name, `%${search}%`)));
    }
    const matchedCountResult = await matchedCountQuery;
    const matchedCount = matchedCountResult[0]?.count || 0;

    let pendingCountQuery = db
      .select({ count: count() })
      .from(suppliers)
      .where(eq(suppliers.matchStatus, "pending"))
      .$dynamic();
    if (search) {
      pendingCountQuery = pendingCountQuery.where(and(eq(suppliers.matchStatus, "pending"), ilike(suppliers.name, `%${search}%`)));
    }
    const pendingCountResult = await pendingCountQuery;
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
