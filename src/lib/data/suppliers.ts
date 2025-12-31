import { db } from "@/db";
import { suppliers, entities, companies, spendEntries } from "@/db/schema";
import { eq, sql, desc, count, ilike, and } from "drizzle-orm";

export interface SupplierWithStats {
  id: number;
  name: string;
  matchStatus: string;
  matchConfidence: string | null;
  entityId: number | null;
  entityName: string | null;
  entityType: string | null;
  companyNumber: string | null;
  totalSpend: number;
  transactionCount: number;
}

export interface SuppliersListResponse {
  suppliers: SupplierWithStats[];
  totalCount: number;
  matchedCount: number;
  pendingCount: number;
  limit: number;
  offset: number;
}

export async function getSuppliers(options: {
  limit?: number;
  offset?: number;
  status?: string;
  search?: string;
  sort?: string;
  order?: "asc" | "desc";
}): Promise<SuppliersListResponse> {
  const { 
    limit = 20, 
    offset = 0, 
    status, 
    search, 
    sort = "totalSpend", 
    order = "desc" 
  } = options;

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
  if (status && status !== "all") {
    filters.push(eq(suppliers.matchStatus, status));
  }
  if (search) {
    filters.push(ilike(suppliers.name, `%${search}%`));
  }

  if (filters.length > 0) {
    query = query.where(and(...filters));
  }

  const suppliersRows = await query
    .orderBy(order === "desc" ? desc(statsQuery.totalSpend) : statsQuery.totalSpend)
    .limit(limit)
    .offset(offset);

  // Counts for tabs/summary
  const searchFilter = search ? ilike(suppliers.name, `%${search}%`) : undefined;

  const [totalCountResult, matchedCountResult, pendingCountResult] = await Promise.all([
    db.select({ count: count() }).from(suppliers).where(searchFilter ? searchFilter : undefined),
    db.select({ count: count() }).from(suppliers).where(
      and(eq(suppliers.matchStatus, "matched"), searchFilter)
    ),
    db.select({ count: count() }).from(suppliers).where(
      and(eq(suppliers.matchStatus, "pending"), searchFilter)
    ),
  ]);

  return {
    suppliers: suppliersRows as any[],
    totalCount: totalCountResult[0]?.count || 0,
    matchedCount: matchedCountResult[0]?.count || 0,
    pendingCount: pendingCountResult[0]?.count || 0,
    limit,
    offset,
  };
}

export async function getPendingSuppliers(options: {
  limit?: number;
  offset?: number;
  search?: string;
}) {
  const { limit = 100, offset = 0, search } = options;

  let query = db
    .select({
      id: suppliers.id,
      name: suppliers.name,
      matchStatus: suppliers.matchStatus,
      matchConfidence: suppliers.matchConfidence,
      entityId: suppliers.entityId,
    })
    .from(suppliers)
    .where(eq(suppliers.matchStatus, "pending"))
    .$dynamic();

  if (search) {
    query = query.where(ilike(suppliers.name, `%${search}%`));
  }

  const rows = await query.limit(limit).offset(offset);
  return rows;
}
