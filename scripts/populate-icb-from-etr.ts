import { db } from "../src/db";
import { organisations } from "../src/db/schema";
import { eq, isNotNull } from "drizzle-orm";
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";

interface EtrRecord {
  odsCode: string;
  name: string;
  region: string;
  icbOdsCode: string;
}

function parseEtrCsv(filePath: string): EtrRecord[] {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n").filter((line) => line.trim());

  const records: EtrRecord[] = [];

  for (const line of lines) {
    // Parse CSV - handle quoted fields
    const matches = line.match(/("([^"]*)"|[^,]*)(,|$)/g);
    if (!matches) continue;

    const fields = matches.map((m) => {
      const val = m.replace(/,$/, "").trim();
      // Remove surrounding quotes
      if (val.startsWith('"') && val.endsWith('"')) {
        return val.slice(1, -1);
      }
      return val;
    });

    const odsCode = fields[0];
    const name = fields[1];
    const region = fields[2];
    const icbOdsCode = fields[3];

    // Skip if no ODS code or ICB code
    if (!odsCode || !icbOdsCode) continue;

    records.push({
      odsCode,
      name,
      region,
      icbOdsCode,
    });
  }

  return records;
}

function askQuestion(
  rl: readline.Interface,
  question: string
): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.toLowerCase().trim());
    });
  });
}

async function main() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log("Loading ETR data from data/etr.csv...");
  const etrPath = path.join(process.cwd(), "data", "etr.csv");
  const etrRecords = parseEtrCsv(etrPath);
  console.log(`Loaded ${etrRecords.length} records from ETR file\n`);

  // Get all organisations from database
  const orgs = await db
    .select({
      id: organisations.id,
      name: organisations.name,
      odsCode: organisations.odsCode,
      icbOdsCode: organisations.icbOdsCode,
    })
    .from(organisations)
    .where(isNotNull(organisations.odsCode));

  console.log(`Found ${orgs.length} organisations with ODS codes in database\n`);

  // Create lookup by ODS code
  const orgsByOdsCode = new Map(orgs.map((o) => [o.odsCode, o]));

  let updated = 0;
  let skipped = 0;
  let notFound = 0;
  let alreadyCorrect = 0;
  let overwrites = 0;

  for (const etr of etrRecords) {
    const org = orgsByOdsCode.get(etr.odsCode);

    if (!org) {
      // Organisation not in our database
      notFound++;
      continue;
    }

    if (org.icbOdsCode === etr.icbOdsCode) {
      // Already has correct ICB code
      alreadyCorrect++;
      continue;
    }

    if (!org.icbOdsCode) {
      // No existing ICB code - update automatically
      await db
        .update(organisations)
        .set({ icbOdsCode: etr.icbOdsCode })
        .where(eq(organisations.id, org.id));

      console.log(
        `✓ Set ICB code for "${org.name}" (${org.odsCode}) → ${etr.icbOdsCode}`
      );
      updated++;
    } else {
      // Existing ICB code differs - ask user
      console.log("\n" + "-".repeat(80));
      console.log(`Organisation: ${org.name} (${org.odsCode})`);
      console.log(`Current ICB code:  ${org.icbOdsCode}`);
      console.log(`ETR ICB code:      ${etr.icbOdsCode}`);

      const answer = await askQuestion(
        rl,
        "Overwrite with ETR value? (y/n/q to quit): "
      );

      if (answer === "q") {
        console.log("\nQuitting...");
        break;
      }

      if (answer === "y" || answer === "yes") {
        await db
          .update(organisations)
          .set({ icbOdsCode: etr.icbOdsCode })
          .where(eq(organisations.id, org.id));

        console.log(`✓ Overwrote ICB code: ${org.icbOdsCode} → ${etr.icbOdsCode}`);
        overwrites++;
      } else {
        console.log("✗ Skipped");
        skipped++;
      }
    }
  }

  rl.close();

  console.log("\n" + "=".repeat(80));
  console.log("Summary:");
  console.log(`  - ${alreadyCorrect} already had correct ICB code`);
  console.log(`  - ${updated} updated (were empty)`);
  console.log(`  - ${overwrites} overwrites (user approved)`);
  console.log(`  - ${skipped} skipped by user`);
  console.log(`  - ${notFound} ETR records not found in database`);

  process.exit(0);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});

