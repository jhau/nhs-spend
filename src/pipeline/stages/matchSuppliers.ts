import { eq, and, isNull, inArray } from "drizzle-orm";
import { entities, companies, suppliers, councils, governmentDepartments } from "@/db/schema";
import type { PipelineStage } from "../types";
import {
  calculateSimilarity,
  searchCompanies,
  getCompanyProfile,
  sleep,
} from "@/lib/companies-house";
import { searchCouncilMetadata } from "@/lib/council-api";
import { searchGovUkOrganisation } from "@/lib/gov-uk";
import {
  findOrCreateCompanyEntity,
  findOrCreateCouncilEntity,
  findOrCreateGovDepartmentEntity,
} from "@/lib/matching-helpers";

export type MatchSuppliersInput = {
  /**
   * Maximum number of suppliers to process in this run.
   * If not provided, will process all pending suppliers.
   */
  limit?: number;
  /**
   * Specific supplier IDs to match.
   */
  supplierIds?: number[];
  /**
   * Similarity threshold for auto-matching (0-1).
   * Defaults to 0.9 (90%).
   */
  autoMatchThreshold?: number;
  /**
   * Minimum similarity threshold to even consider a match (0-1).
   * Defaults to 0.5 (50%).
   */
  minSimilarityThreshold?: number;
};

export const matchSuppliersStage: PipelineStage<MatchSuppliersInput> = {
  id: "matchSuppliers",
  title: "Match suppliers with Companies House",
  async run(ctx, input) {
    const apiKey = process.env.COMPANIES_HOUSE_API_KEY;
    if (!apiKey) {
      throw new Error("COMPANIES_HOUSE_API_KEY is not set");
    }

    const autoMatchThreshold = input.autoMatchThreshold ?? 0.9;
    const minSimilarityThreshold = input.minSimilarityThreshold ?? 0.5;
    const limit = input.limit;
    const supplierIds = input.supplierIds;

    await ctx.log({
      level: "info",
      message: "Starting supplier matching process",
      meta: { limit, supplierIds, autoMatchThreshold, minSimilarityThreshold },
    });

    // Get unmatched suppliers
    let query = ctx.db
      .select({ id: suppliers.id, name: suppliers.name })
      .from(suppliers)
      .where(
        and(
          eq(suppliers.matchStatus, "pending"),
          supplierIds && supplierIds.length > 0
            ? inArray(suppliers.id, supplierIds)
            : isNull(suppliers.matchAttemptedAt)
        )
      );

    if (limit) {
      query = query.limit(limit) as any;
    }

    const pendingSuppliers = await query;

    await ctx.log({
      level: "info",
      message: `Found ${pendingSuppliers.length} pending suppliers to match`,
    });

    let matchedCount = 0;
    let noMatchCount = 0;
    let errorCount = 0;
    let skippedCount = 0;
    let processedCount = 0;

    for (const supplier of pendingSuppliers) {
      processedCount++;

      // Progress update every 50 suppliers
      if (processedCount % 50 === 0) {
        await ctx.log({
          level: "info",
          message: `Progress: ${processedCount}/${pendingSuppliers.length} suppliers processed`,
          meta: { matchedCount, noMatchCount, errorCount, skippedCount },
        });
      }

      try {
        // Skip numeric strings (likely not company names)
        if (/^\d+$/.test(supplier.name.trim())) {
          await ctx.log({
            level: "info",
            message: `Skipping numeric supplier name: ${supplier.name}`,
            meta: { supplierId: supplier.id },
          });
          await ctx.db
            .update(suppliers)
            .set({
              matchStatus: "no_match",
              manuallyVerified: true,
              matchAttemptedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(suppliers.id, supplier.id));
          noMatchCount++;
          continue;
        }

        // Check for councils first if name contains "council"
        if (supplier.name.toLowerCase().includes("council")) {
          await ctx.log({
            level: "debug",
            message: `Supplier name contains 'council', attempting specialized council lookup: ${supplier.name}`,
            meta: { supplierId: supplier.id },
          });

          const councilMetadata = await searchCouncilMetadata(supplier.name);
          if (councilMetadata) {
            const entityId = await findOrCreateCouncilEntity(
              ctx.db,
              councilMetadata
            );

            await ctx.db
              .update(suppliers)
              .set({
                entityId,
                matchStatus: "matched",
                matchConfidence: "1.00",
                manuallyVerified: false,
                matchAttemptedAt: new Date(),
                updatedAt: new Date(),
              })
              .where(eq(suppliers.id, supplier.id));

            await ctx.log({
              level: "info",
              message: `Council auto-matched: ${supplier.name} -> ${councilMetadata.officialName}`,
              meta: {
                supplierId: supplier.id,
                gssCode: councilMetadata.gssCode,
                entityId,
              },
            });
            matchedCount++;
            continue;
          } else {
            // Name contains "council" but not found in official CSV
            // Mark for review instead of auto-matching to a company
            await ctx.db
              .update(suppliers)
              .set({
                matchStatus: "pending_review",
                matchConfidence: "0.50",
                matchAttemptedAt: new Date(),
                updatedAt: new Date(),
              })
              .where(eq(suppliers.id, supplier.id));

            await ctx.log({
              level: "info",
              message: `Supplier name contains 'council' but not found in local CSV, marking for review: ${supplier.name}`,
              meta: { supplierId: supplier.id },
            });
            skippedCount++;
            continue;
          }
        }

        // Check for government departments
        const govKeywords = [
          "department",
          "ministry",
          "office",
          "agency",
          "authority",
          "government",
        ];
        if (
          govKeywords.some((keyword) =>
            supplier.name.toLowerCase().includes(keyword)
          )
        ) {
          const govDept = await searchGovUkOrganisation(supplier.name, ctx.log);
          if (govDept) {
            const entityId = await findOrCreateGovDepartmentEntity(
              ctx.db,
              govDept
            );

            await ctx.db
              .update(suppliers)
              .set({
                entityId,
                matchStatus: "matched",
                matchConfidence: "1.00",
                manuallyVerified: false,
                matchAttemptedAt: new Date(),
                updatedAt: new Date(),
              })
              .where(eq(suppliers.id, supplier.id));

            await ctx.log({
              level: "info",
              message: `Gov department auto-matched: ${supplier.name} -> ${govDept.title}`,
              meta: {
                supplierId: supplier.id,
                slug: govDept.slug,
                entityId,
              },
            });
            matchedCount++;
            continue;
          }
        }

        // Search Companies House
        let searchData;
        try {
          searchData = await searchCompanies(supplier.name, apiKey);
        } catch (err: any) {
          if (err.message.includes("429")) {
            await ctx.log({
              level: "warn",
              message: "Rate limit hit, waiting 60s",
            });
            await sleep(60000);
            skippedCount++;
            continue;
          }
          await ctx.log({
            level: "error",
            message: `API error searching for ${supplier.name}: ${err.message}`,
            meta: { name: supplier.name, supplierId: supplier.id },
          });
          errorCount++;
          continue;
        }

        if (!searchData.items || searchData.items.length === 0) {
          await ctx.log({
            level: "info",
            message: `No results found for: ${supplier.name}`,
            meta: { supplierId: supplier.id },
          });
          await ctx.db
            .update(suppliers)
            .set({
              matchStatus: "no_match",
              manuallyVerified: false,
              matchAttemptedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(suppliers.id, supplier.id));
          noMatchCount++;
          continue;
        }

        // Find best match
        const resultsWithSimilarity = searchData.items.map((item) => ({
          ...item,
          similarity: calculateSimilarity(supplier.name, item.title),
        }));

        resultsWithSimilarity.sort((a, b) => b.similarity - a.similarity);
        const bestMatch = resultsWithSimilarity[0];

        if (bestMatch.similarity >= autoMatchThreshold) {
          // Get full profile for the best match
          try {
            const profile = await getCompanyProfile(
              bestMatch.company_number,
              apiKey
            );

            // Find or create entity and company
            const entityId = await findOrCreateCompanyEntity(ctx.db, profile);

            // Link supplier to entity
            await ctx.db
              .update(suppliers)
              .set({
                entityId,
                matchStatus: "matched",
                matchConfidence: bestMatch.similarity.toFixed(2),
                manuallyVerified: false,
                matchAttemptedAt: new Date(),
                updatedAt: new Date(),
              })
              .where(eq(suppliers.id, supplier.id));

            await ctx.log({
              level: "info",
              message: `Auto-matched: ${supplier.name} -> ${
                profile.company_name
              } (${(bestMatch.similarity * 100).toFixed(1)}%)`,
              meta: {
                supplierId: supplier.id,
                companyNumber: profile.company_number,
                entityId,
                confidence: bestMatch.similarity,
              },
            });
            matchedCount++;
          } catch (err: any) {
            await ctx.log({
              level: "error",
              message: `Error fetching profile for ${bestMatch.company_number} (${bestMatch.title}): ${err.message}`,
              meta: { supplierId: supplier.id, supplierName: supplier.name },
            });
            errorCount++;
          }
        } else if (bestMatch.similarity < minSimilarityThreshold) {
          // Too low similarity, mark as no match
          await ctx.log({
            level: "info",
            message: `No confident match for: ${supplier.name} (Best match: ${
              bestMatch.title
            } at ${(bestMatch.similarity * 100).toFixed(1)}%)`,
            meta: {
              supplierId: supplier.id,
              bestMatch: bestMatch.title,
              similarity: bestMatch.similarity,
            },
          });
          await ctx.db
            .update(suppliers)
            .set({
              matchStatus: "no_match",
              manuallyVerified: false,
              matchAttemptedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(suppliers.id, supplier.id));
          noMatchCount++;
        } else {
          // Moderate similarity, mark for manual review
          await ctx.log({
            level: "info",
            message: `Moderate match, pending review: ${
              supplier.name
            } (Best match: ${bestMatch.title} at ${(
              bestMatch.similarity * 100
            ).toFixed(1)}%)`,
            meta: {
              supplierId: supplier.id,
              bestMatch: bestMatch.title,
              similarity: bestMatch.similarity,
            },
          });
          await ctx.db
            .update(suppliers)
            .set({
              matchStatus: "pending_review",
              matchConfidence: bestMatch.similarity.toFixed(2),
              matchAttemptedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(suppliers.id, supplier.id));
          skippedCount++;
        }
      } catch (err) {
        await ctx.log({
          level: "error",
          message: `Unexpected error for ${supplier.name}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        });
        errorCount++;
      }
    }

    return {
      status: "succeeded",
      metrics: {
        totalProcessed: pendingSuppliers.length,
        matchedCount,
        noMatchCount,
        skippedCount,
        errorCount,
      },
    };
  },
};
