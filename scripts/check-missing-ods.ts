import "dotenv/config";

import { isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { organisations } from "@/db/schema";

interface OdsOrganisation {
  Name: string;
  OrgId: string;
  Status: string;
  PostCode: string;
  PrimaryRoleId: string;
  PrimaryRoleDescription: string;
}

interface OdsResponse {
  Organisations: OdsOrganisation[];
}

// Role IDs for NHS organisations
const NHS_ROLES = {
  RO197: "NHS TRUST",
  RO57: "NHS FOUNDATION TRUST",
  RO261: "INTEGRATED CARE BOARD",
  RO98: "COMMISSIONING SUPPORT UNIT",
};

async function searchOds(searchTerm: string): Promise<OdsOrganisation[]> {
  const url = `https://directory.spineservices.nhs.uk/ORD/2-0-0/organisations?Name=${encodeURIComponent(searchTerm)}&Status=Active`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      return [];
    }
    const data: OdsResponse = await response.json();
    return data.Organisations;
  } catch (error) {
    return [];
  }
}

function cleanName(name: string): string {
  return name
    .replace(/NHS Foundation Trust$/i, "")
    .replace(/NHS Trust$/i, "")
    .replace(/NHSFT$/i, "")
    .replace(/NHST$/i, "")
    .replace(/NHS FT$/i, "")
    .replace(/NHS FDN Trust$/i, "")
    .replace(/ ICB$/i, "")
    .replace(/Integrated Care Board$/i, "")
    .replace(/ CCG$/i, "")
    .replace(/ BU$/i, "") // Business Unit suffix
    .replace(/—.*$/, "") // Remove notes
    .replace(/\s+/g, " ")
    .trim();
}

function isLikelyNhsOrganisation(name: string): boolean {
  const lowerName = name.toLowerCase();
  // Exclude numeric-looking names (bad data)
  if (/^\d+(\.\d+)?$/.test(name)) return false;
  // Exclude supply chain categories
  if (lowerName.includes("wound care") || lowerName.includes("products") || 
      lowerName.includes("devices") || lowerName.includes("consumables") ||
      lowerName.includes("equipment") || lowerName.includes("solutions") ||
      lowerName.includes("services 20") || lowerName.includes("lot ")) return false;
  // Exclude internal departments
  if (name.startsWith("ACS ") || name === "CORPORATE ESTATES" || 
      name === "DIGITAL SERVICES" || name.includes("INPATIENTS") ||
      name.includes("LOCALITY") || name === "FINANCE" || name === "MEDICAL") return false;
  // Include if contains NHS, Hospital, Trust, ICB, CCG
  return lowerName.includes("nhs") || lowerName.includes("hospital") || 
         lowerName.includes("trust") || lowerName.includes(" icb") ||
         lowerName.includes(" ccg") || lowerName.includes("healthcare");
}

async function main() {
  // Get all organisations without ODS codes
  const orgs = await db
    .select()
    .from(organisations)
    .where(isNull(organisations.odsCode))
    .orderBy(organisations.name);

  console.log(`Found ${orgs.length} organisations without ODS codes\n`);

  // Filter to likely NHS organisations
  const nhsOrgs = orgs.filter(org => isLikelyNhsOrganisation(org.name));
  console.log(`${nhsOrgs.length} appear to be NHS organisations\n`);
  console.log("=".repeat(100));

  const results: { 
    local: string; 
    matches: Array<{ name: string; id: string; role: string }> 
  }[] = [];

  for (const org of nhsOrgs) {
    const cleanedName = cleanName(org.name);
    
    // Try different search variations
    const searchTerms = [cleanedName];
    
    // For names with "&" try both forms
    if (cleanedName.includes("&")) {
      searchTerms.push(cleanedName.replace(/&/g, "and"));
    }
    if (cleanedName.includes(" and ")) {
      searchTerms.push(cleanedName.replace(/ and /g, " & "));
    }
    
    // Extract key words for broader search
    const words = cleanedName.split(/\s+/).filter(w => w.length > 3);
    if (words.length > 0) {
      searchTerms.push(words[0]); // First significant word
    }

    let allMatches: OdsOrganisation[] = [];
    
    for (const term of searchTerms) {
      const matches = await searchOds(term);
      // Filter to NHS-related roles
      const nhsMatches = matches.filter(m => 
        Object.keys(NHS_ROLES).includes(m.PrimaryRoleId)
      );
      allMatches.push(...nhsMatches);
      await new Promise(resolve => setTimeout(resolve, 500)); // Rate limit - 500ms between requests
    }

    // Deduplicate
    const uniqueMatches = Array.from(
      new Map(allMatches.map(m => [m.OrgId, m])).values()
    );

    console.log(`\nLocal: "${org.name}"`);
    if (uniqueMatches.length > 0) {
      console.log(`  Potential matches from ODS:`);
      uniqueMatches.slice(0, 5).forEach(m => {
        const role = NHS_ROLES[m.PrimaryRoleId as keyof typeof NHS_ROLES] || m.PrimaryRoleId;
        console.log(`    - ${m.Name} (${m.OrgId}) [${role}]`);
      });
    } else {
      console.log(`  No matches found in ODS`);
    }

    results.push({
      local: org.name,
      matches: uniqueMatches.slice(0, 5).map(m => ({
        name: m.Name,
        id: m.OrgId,
        role: NHS_ROLES[m.PrimaryRoleId as keyof typeof NHS_ROLES] || m.PrimaryRoleId
      }))
    });

    // Extra delay between organisations to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 300));
  }

  console.log("\n" + "=".repeat(100));
  console.log("\nSUMMARY:");
  console.log(`Total without ODS: ${orgs.length}`);
  console.log(`Likely NHS orgs: ${nhsOrgs.length}`);
  console.log(`With potential matches: ${results.filter(r => r.matches.length > 0).length}`);
  console.log(`No matches found: ${results.filter(r => r.matches.length === 0).length}`);

  process.exit(0);
}

main().catch(console.error);

