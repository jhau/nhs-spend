import { eq } from "drizzle-orm";
import { companies, suppliers } from "@/db/schema";
import type { PipelineStage } from "../types";
import {
  calculateSimilarity,
  searchCompanies,
  getCompanyProfile,
  sleep,
} from "@/lib/companies-house";

export type MatchSuppliersInput = {
  /**
   * Maximum number of suppliers to process in this run.
   * If not provided, will process all pending suppliers.
   */
  limit?: number;
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

    await ctx.log({
      level: "info",
      message: "Starting supplier matching process",
      meta: { limit, autoMatchThreshold, minSimilarityThreshold },
    });

    // Get unmatched suppliers
    let query = ctx.db
      .select({ id: suppliers.id, name: suppliers.name })
      .from(suppliers)
      .where(eq(suppliers.matchStatus, "pending"));

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
              updatedAt: new Date(),
            })
            .where(eq(suppliers.id, supplier.id));
          noMatchCount++;
          continue;
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

            // Check if company exists
            let companyId: number;
            const existingCompany = await ctx.db
              .select({ id: companies.id })
              .from(companies)
              .where(eq(companies.companyNumber, profile.company_number))
              .limit(1);

            if (existingCompany.length > 0) {
              companyId = existingCompany[0].id;
            } else {
              const insertedCompany = await ctx.db
                .insert(companies)
                .values({
                  companyNumber: profile.company_number,
                  companyName: profile.company_name,
                  companyStatus: profile.company_status,
                  companyType: profile.type,
                  dateOfCreation: profile.date_of_creation || null,
                  jurisdiction: profile.jurisdiction || null,
                  addressLine1:
                    profile.registered_office_address?.address_line_1 || null,
                  addressLine2:
                    profile.registered_office_address?.address_line_2 || null,
                  locality: profile.registered_office_address?.locality || null,
                  postalCode:
                    profile.registered_office_address?.postal_code || null,
                  country: profile.registered_office_address?.country || null,
                  sicCodes: profile.sic_codes || null,
                  previousNames: profile.previous_names || null,
                  rawData: profile,
                  etag: profile.etag || null,
                  fetchedAt: new Date(),
                })
                .returning({ id: companies.id });
              companyId = insertedCompany[0].id;
            }

            // Link supplier
            await ctx.db
              .update(suppliers)
              .set({
                companyId,
                matchStatus: "matched",
                matchConfidence: bestMatch.similarity.toFixed(2),
                manuallyVerified: false,
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
              updatedAt: new Date(),
            })
            .where(eq(suppliers.id, supplier.id));
          noMatchCount++;
        } else {
          // Moderate similarity, keep as pending for manual review
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
