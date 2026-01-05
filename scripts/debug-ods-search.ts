import "dotenv/config";
import { searchNhsOrganisation } from "../src/lib/nhs-api";

async function test() {
  const names = [
    "NHS NORTH EAST AND NORTH CUMBRIA ICB",
    "NHS North East and North Cumbria Integrated Care Board"
  ];
  
  for (const name of names) {
    console.log(`\nSearching for: "${name}"`);
    const results = await searchNhsOrganisation(name);
    console.log(`Found ${results.length} results:`);
    results.forEach(r => {
      console.log(`- ${r.Name} (${r.OrgId}) [${r.PrimaryRoleDescription}]`);
    });
  }
}

test().catch(console.error);

