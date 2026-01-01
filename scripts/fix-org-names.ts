/**
 * @deprecated This script needs updating for the new schema.
 * ODS codes are now stored on nhsOrganisations linked via entities,
 * not directly on buyers. Use the pipeline import stages instead.
 */
import "dotenv/config";
import * as readline from "readline";
import * as fs from "fs";
import * as path from "path";
import stringSimilarity from "string-similarity";

import { eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { buyers, spendEntries } from "@/db/schema";

const AUTO_APPLY_THRESHOLD = 0.9; // Auto-apply if similarity >= 90%

interface OfficialOrg {
  odsCode: string;
  officialName: string;
  type: string;
  postCode: string;
}

// Parse CSV line handling quoted fields
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

// Load official names from CSV files
function loadOfficialData(): {
  byOdsCode: Map<string, OfficialOrg>;
  byNormalizedName: Map<string, OfficialOrg>;
} {
  const byOdsCode = new Map<string, OfficialOrg>();
  const byNormalizedName = new Map<string, OfficialOrg>();

  // Load trusts from etr.csv
  const etrPath = path.join(process.cwd(), "data", "etr.csv");
  const etrContent = fs.readFileSync(etrPath, "utf-8");
  for (const line of etrContent.split("\n")) {
    if (!line.trim()) continue;
    const fields = parseCSVLine(line);
    const odsCode = fields[0];
    const name = fields[1];
    const postCode = fields[9] || "";
    if (odsCode && name) {
      const org: OfficialOrg = {
        odsCode,
        officialName: name,
        type: "Trust",
        postCode,
      };
      byOdsCode.set(odsCode, org);
      byNormalizedName.set(normalizeName(name), org);
    }
  }

  // Load CCGs/ICBs from eccg.csv
  const eccgPath = path.join(process.cwd(), "data", "eccg.csv");
  const eccgContent = fs.readFileSync(eccgPath, "utf-8");
  for (const line of eccgContent.split("\n")) {
    if (!line.trim()) continue;
    const fields = parseCSVLine(line);
    const odsCode = fields[0];
    const name = fields[1];
    const postCode = fields[9] || "";
    if (odsCode && name) {
      const org: OfficialOrg = {
        odsCode,
        officialName: name,
        type: "CCG/ICB",
        postCode,
      };
      byOdsCode.set(odsCode, org);
      byNormalizedName.set(normalizeName(name), org);
    }
  }

  return { byOdsCode, byNormalizedName };
}

// Normalize name for comparison
function normalizeName(name: string): string {
  return name
    .toUpperCase()
    .replace(/['']/g, "'")
    .replace(/&/g, "AND")
    .replace(/NHS FOUNDATION TRUST$/i, "NHS FOUNDATION TRUST")
    .replace(/NHS FT$/i, "NHS FOUNDATION TRUST")
    .replace(/NHSFT$/i, "NHS FOUNDATION TRUST")
    .replace(/NHS TRUST$/i, "NHS TRUST")
    .replace(/\s+/g, " ")
    .trim();
}

// Try to find a match for a local name in official data
function findMatch(
  localName: string,
  byNormalizedName: Map<string, OfficialOrg>
): OfficialOrg | null {
  const normalized = normalizeName(localName);

  // Direct match
  if (byNormalizedName.has(normalized)) {
    return byNormalizedName.get(normalized)!;
  }

  // Try variations
  const variations = [
    normalized,
    normalized.replace(/ NHS FOUNDATION TRUST$/, ""),
    normalized.replace(/ NHS TRUST$/, ""),
    normalized.replace(/ BU$/, ""), // Business Unit suffix
  ];

  for (const [key, value] of byNormalizedName) {
    for (const variation of variations) {
      if (key.includes(variation) || variation.includes(key)) {
        // Check it's a reasonable match (not too different in length)
        if (Math.abs(key.length - variation.length) < 30) {
          return value;
        }
      }
    }
  }

  return null;
}

async function askQuestion(
  rl: readline.Interface,
  question: string
): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim().toLowerCase());
    });
  });
}

// Merge duplicate buyer into target, moving all spend data
async function mergeBuyers(
  sourceId: number,
  sourceName: string,
  targetId: number,
  targetName: string
): Promise<{ spendEntriesMoved: number }> {
  // Count spend entries to move
  const countResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(spendEntries)
    .where(eq(spendEntries.buyerId, sourceId));
  const spendEntriesMoved = countResult[0]?.count || 0;

  // Move spend entries from source to target
  if (spendEntriesMoved > 0) {
    await db
      .update(spendEntries)
      .set({ buyerId: targetId })
      .where(eq(spendEntries.buyerId, sourceId));
  }

  // Delete the source buyer
  await db.delete(buyers).where(eq(buyers.id, sourceId));

  console.log(
    `  Merged "${sourceName}" (id: ${sourceId}) into "${targetName}" (id: ${targetId})`
  );
  console.log(`  Moved ${spendEntriesMoved} spend entries`);

  return { spendEntriesMoved };
}

interface Mismatch {
  id: number;
  currentName: string;
  currentOdsCode: string | null;
  officialName: string;
  officialOdsCode: string;
  postCode: string;
  type: "name_mismatch" | "missing_ods" | "duplicate_to_merge";
  similarity: number;
  targetOrgId?: number;
  targetOrgName?: string;
}

async function main() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log("Loading official names from CSV files...\n");
  const { byOdsCode, byNormalizedName } = loadOfficialData();
  console.log(`Loaded ${byOdsCode.size} official organisation records\n`);

  // Get all buyers from database
  const orgs = await db
    .select()
    .from(buyers)
    .orderBy(buyers.name);

  console.log(`Found ${orgs.length} buyers in database\n`);

  const mismatches: Mismatch[] = [];

  // Find mismatches - organisations WITH ODS codes but wrong names
  for (const org of orgs) {
    if (!org.odsCode) continue;

    const official = byOdsCode.get(org.odsCode);
    if (!official) continue;

    const normalizedCurrent = normalizeName(org.name);
    const normalizedOfficial = normalizeName(official.officialName);

    if (normalizedCurrent !== normalizedOfficial) {
      const similarity = stringSimilarity.compareTwoStrings(
        normalizedCurrent.toLowerCase(),
        normalizedOfficial.toLowerCase()
      );
      mismatches.push({
        id: org.id,
        currentName: org.name,
        currentOdsCode: org.odsCode,
        officialName: official.officialName,
        officialOdsCode: official.odsCode,
        postCode: official.postCode,
        type: "name_mismatch",
        similarity,
      });
    }
  }

  // Find organisations WITHOUT ODS codes that match official names
  for (const org of orgs) {
    if (org.odsCode) continue; // Already has ODS code

    const match = findMatch(org.name, byNormalizedName);
    if (match) {
      const similarity = stringSimilarity.compareTwoStrings(
        normalizeName(org.name).toLowerCase(),
        normalizeName(match.officialName).toLowerCase()
      );

      // Check if this ODS code is already used by another org
      const existingWithCode = orgs.find(
        (o) => o.odsCode === match.odsCode && o.id !== org.id
      );

      if (existingWithCode) {
        // This is a duplicate - should be merged into the existing org
        mismatches.push({
          id: org.id,
          currentName: org.name,
          currentOdsCode: null,
          officialName: match.officialName,
          officialOdsCode: match.odsCode,
          postCode: match.postCode,
          type: "duplicate_to_merge",
          similarity,
          targetOrgId: existingWithCode.id,
          targetOrgName: existingWithCode.name,
        });
      } else {
        mismatches.push({
          id: org.id,
          currentName: org.name,
          currentOdsCode: null,
          officialName: match.officialName,
          officialOdsCode: match.odsCode,
          postCode: match.postCode,
          type: "missing_ods",
          similarity,
        });
      }
    }
  }

  console.log("=".repeat(100));
  console.log(`\nFound ${mismatches.length} issues:`);
  console.log(
    `  - ${
      mismatches.filter((m) => m.type === "name_mismatch").length
    } name mismatches`
  );
  console.log(
    `  - ${
      mismatches.filter((m) => m.type === "missing_ods").length
    } missing ODS codes with potential matches`
  );
  console.log(
    `  - ${
      mismatches.filter((m) => m.type === "duplicate_to_merge").length
    } duplicates to merge (ODS code already assigned to another org)`
  );

  if (mismatches.length === 0) {
    console.log("\nAll organisation names match official records!");
    rl.close();
    process.exit(0);
  }

  let autoUpdated = 0;
  let manualUpdated = 0;
  let skipped = 0;

  // Track ODS codes applied during this run to avoid duplicates
  // Maps ODS code -> org id that received it
  const appliedOdsCodes = new Map<string, { id: number; name: string }>();

  // Sort by similarity descending so high-confidence matches come first
  mismatches.sort((a, b) => b.similarity - a.similarity);

  let merged = 0;

  for (const mismatch of mismatches) {
    // Handle duplicates that need to be merged (ODS code already exists in DB)
    if (mismatch.type === "duplicate_to_merge") {
      console.log("\n" + "-".repeat(80));
      const similarityPct = (mismatch.similarity * 100).toFixed(1);
      const autoMerge = mismatch.similarity >= AUTO_APPLY_THRESHOLD;

      console.log(
        `[DUPLICATE TO MERGE] Similarity: ${similarityPct}%`
      );
      console.log(
        `ODS code ${mismatch.officialOdsCode} is already assigned to another organisation.`
      );
      console.log(`\nDuplicate org:  "${mismatch.currentName}" (id: ${mismatch.id})`);
      console.log(`Target org:     "${mismatch.targetOrgName}" (id: ${mismatch.targetOrgId})`);
      console.log(`Official name:  "${mismatch.officialName}"`);
      console.log(`\nWill merge: move all spend data to target, then delete duplicate`);

      let shouldMerge = false;
      if (autoMerge && mismatch.targetOrgId) {
        console.log(
          `\n✓ Auto-merging (similarity >= ${AUTO_APPLY_THRESHOLD * 100}%)`
        );
        shouldMerge = true;
      } else {
        const answer = await askQuestion(
          rl,
          "\nMerge duplicate into target? (y to merge/n to skip/q to quit): "
        );
        if (answer === "q") {
          console.log("\nQuitting...");
          break;
        }
        shouldMerge = (answer === "y" || answer === "yes") && !!mismatch.targetOrgId;
      }

      if (shouldMerge && mismatch.targetOrgId && mismatch.targetOrgName) {
        await mergeOrganisations(
          mismatch.id,
          mismatch.currentName,
          mismatch.targetOrgId,
          mismatch.targetOrgName
        );
        merged++;
      } else {
        console.log("✗ Skipped");
        skipped++;
      }
      continue;
    }

    // Check if we've already applied this ODS code during this run
    if (
      mismatch.type === "missing_ods" &&
      appliedOdsCodes.has(mismatch.officialOdsCode)
    ) {
      // Get the organisation that received this ODS code
      const targetOrg = appliedOdsCodes.get(mismatch.officialOdsCode);

      console.log("\n" + "-".repeat(80));
      const similarityPct = (mismatch.similarity * 100).toFixed(1);
      const autoMerge = mismatch.similarity >= AUTO_APPLY_THRESHOLD;

      console.log(`⚠ DUPLICATE ORGANISATION DETECTED - Similarity: ${similarityPct}%`);
      console.log(
        `ODS code ${mismatch.officialOdsCode} was already applied to another organisation.`
      );
      console.log(`\nDuplicate org:  "${mismatch.currentName}" (id: ${mismatch.id})`);
      if (targetOrg) {
        console.log(`Target org:     "${targetOrg.name}" (id: ${targetOrg.id})`);
      }
      console.log(`Official name:  "${mismatch.officialName}"`);

      let shouldMerge = false;
      if (autoMerge && targetOrg) {
        console.log(
          `\n✓ Auto-merging (similarity >= ${AUTO_APPLY_THRESHOLD * 100}%)`
        );
        shouldMerge = true;
      } else {
        const answer = await askQuestion(
          rl,
          "\nMerge duplicate into target? (y to merge/n to skip/q to quit): "
        );
        if (answer === "q") {
          console.log("\nQuitting...");
          break;
        }
        shouldMerge = (answer === "y" || answer === "yes") && !!targetOrg;
      }

      if (shouldMerge && targetOrg) {
        await mergeOrganisations(
          mismatch.id,
          mismatch.currentName,
          targetOrg.id,
          targetOrg.name
        );
        merged++;
      } else {
        console.log("✗ Skipped");
        skipped++;
      }
      continue;
    }

    console.log("\n" + "-".repeat(80));

    const similarityPct = (mismatch.similarity * 100).toFixed(1);
    const autoApply = mismatch.similarity >= AUTO_APPLY_THRESHOLD;

    if (mismatch.type === "name_mismatch") {
      console.log(`[NAME MISMATCH] Similarity: ${similarityPct}%`);
      console.log(`ODS Code: ${mismatch.officialOdsCode}`);
      console.log(`Current name:  "${mismatch.currentName}"`);
      console.log(`Official name: "${mismatch.officialName}"`);
      console.log(`\nWill update: name`);
    } else {
      console.log(
        `[MISSING ODS CODE - POTENTIAL MATCH] Similarity: ${similarityPct}%`
      );
      console.log(`Current name:  "${mismatch.currentName}"`);
      console.log(`Official name: "${mismatch.officialName}"`);
      console.log(`ODS Code: ${mismatch.officialOdsCode}`);
      console.log(`Post Code: ${mismatch.postCode}`);
      console.log(`\nWill update: name + ODS code + post code`);
    }

    let shouldApply = false;

    if (autoApply) {
      console.log(
        `\n✓ Auto-applying (similarity >= ${AUTO_APPLY_THRESHOLD * 100}%)`
      );
      shouldApply = true;
    } else {
      const answer = await askQuestion(rl, "\nApply update? (y/n/q to quit): ");

      if (answer === "q") {
        console.log("\nQuitting...");
        break;
      }

      shouldApply = answer === "y" || answer === "yes";
    }

    if (shouldApply) {
      const updateData: { name: string; odsCode?: string; postCode?: string } =
        {
          name: mismatch.officialName,
        };

      if (mismatch.type === "missing_ods") {
        updateData.odsCode = mismatch.officialOdsCode;
        if (mismatch.postCode) {
          updateData.postCode = mismatch.postCode;
        }
      }

      try {
        await db
          .update(organisations)
          .set(updateData)
          .where(eq(organisations.id, mismatch.id));

        // Track applied ODS code with the org that received it
        if (updateData.odsCode) {
          appliedOdsCodes.set(updateData.odsCode, {
            id: mismatch.id,
            name: mismatch.officialName,
          });
        }

        if (autoApply) {
          autoUpdated++;
        } else {
          console.log("✓ Updated");
          manualUpdated++;
        }
      } catch (error: unknown) {
        const err = error as { cause?: { code?: string } };
        if (err.cause?.code === "23505") {
          // Duplicate key - ODS code already exists in database
          // Find the existing organisation with this ODS code
          const existingOrg = await db
            .select()
            .from(organisations)
            .where(eq(organisations.odsCode, mismatch.officialOdsCode))
            .limit(1);

          const similarityPct = (mismatch.similarity * 100).toFixed(1);
          const autoMerge = mismatch.similarity >= AUTO_APPLY_THRESHOLD;

          console.log(
            `\n⚠ DUPLICATE ORGANISATION IN DATABASE - Similarity: ${similarityPct}%`
          );
          console.log(`ODS code ${mismatch.officialOdsCode} already exists.`);
          console.log(`\nDuplicate org:  "${mismatch.currentName}" (id: ${mismatch.id})`);
          if (existingOrg[0]) {
            console.log(`Existing org:   "${existingOrg[0].name}" (id: ${existingOrg[0].id})`);
          }

          let shouldMerge = false;
          if (autoMerge && existingOrg[0]) {
            console.log(
              `\n✓ Auto-merging (similarity >= ${AUTO_APPLY_THRESHOLD * 100}%)`
            );
            shouldMerge = true;
          } else {
            const answer = await askQuestion(
              rl,
              "Merge duplicate into existing? (y to merge/n to skip/q to quit): "
            );
            if (answer === "q") {
              console.log("\nQuitting...");
              break;
            }
            shouldMerge = (answer === "y" || answer === "yes") && !!existingOrg[0];
          }

          if (shouldMerge && existingOrg[0]) {
            await mergeOrganisations(
              mismatch.id,
              mismatch.currentName,
              existingOrg[0].id,
              existingOrg[0].name
            );
            merged++;
          } else {
            console.log("✗ Skipped");
            skipped++;
          }
        } else {
          throw error;
        }
      }
    } else {
      console.log("✗ Skipped");
      skipped++;
    }
  }

  console.log("\n" + "=".repeat(100));
  console.log(`\nSummary:`);
  console.log(
    `  Auto-updated (≥${AUTO_APPLY_THRESHOLD * 100}% similar): ${autoUpdated}`
  );
  console.log(`  Manually updated: ${manualUpdated}`);
  console.log(`  Merged duplicates: ${merged}`);
  console.log(`  Skipped: ${skipped}`);
  console.log(`  Total issues: ${mismatches.length}`);

  rl.close();
  process.exit(0);
}

main().catch(console.error);
