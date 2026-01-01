/**
 * @deprecated This script needs updating for the new schema.
 * Coordinates are now stored on entities, not directly on buyers.
 * Use the pipeline import stages instead.
 */
import "dotenv/config";

import { eq, isNotNull, isNull, and } from "drizzle-orm";

import { db } from "@/db";
import { entities } from "@/db/schema";

interface PostcodeResult {
  status: number;
  result: {
    postcode: string;
    latitude: number;
    longitude: number;
  } | null;
}

interface BulkPostcodeResponse {
  status: number;
  result: Array<{
    query: string;
    result: {
      postcode: string;
      latitude: number;
      longitude: number;
    } | null;
  }>;
}

async function geocodePostcodes(
  postcodes: string[]
): Promise<Map<string, { lat: number; lng: number }>> {
  const results = new Map<string, { lat: number; lng: number }>();

  // postcodes.io supports bulk lookup of up to 100 postcodes
  const url = "https://api.postcodes.io/postcodes";

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ postcodes }),
    });

    if (!response.ok) {
      console.error(`Failed to geocode: ${response.status}`);
      return results;
    }

    const data: BulkPostcodeResponse = await response.json();

    for (const item of data.result) {
      if (item.result) {
        results.set(item.query.toUpperCase().replace(/\s+/g, " "), {
          lat: item.result.latitude,
          lng: item.result.longitude,
        });
      }
    }
  } catch (error) {
    console.error("Error geocoding:", error);
  }

  return results;
}

async function main() {
  // Get all organisations with postcode but no coordinates
  const orgs = await db
    .select()
    .from(organisations)
    .where(
      and(isNotNull(organisations.postCode), isNull(organisations.latitude))
    );

  console.log(`Found ${orgs.length} organisations to geocode\n`);

  if (orgs.length === 0) {
    console.log("Nothing to do!");
    process.exit(0);
  }

  // Collect postcodes
  const postcodeToOrgs = new Map<string, typeof orgs>();
  for (const org of orgs) {
    if (!org.postCode) continue;
    const normalized = org.postCode.toUpperCase().replace(/\s+/g, " ");
    const existing = postcodeToOrgs.get(normalized) || [];
    existing.push(org);
    postcodeToOrgs.set(normalized, existing);
  }

  const postcodes = Array.from(postcodeToOrgs.keys());
  console.log(`Unique postcodes: ${postcodes.length}`);

  // Geocode in batches of 100
  let updated = 0;
  let failed = 0;

  for (let i = 0; i < postcodes.length; i += 100) {
    const batch = postcodes.slice(i, i + 100);
    console.log(`Geocoding batch ${Math.floor(i / 100) + 1}...`);

    const results = await geocodePostcodes(batch);

    for (const [postcode, coords] of results) {
      const matchingOrgs = postcodeToOrgs.get(postcode) || [];
      for (const org of matchingOrgs) {
        await db
          .update(organisations)
          .set({
            latitude: coords.lat,
            longitude: coords.lng,
          })
          .where(eq(organisations.id, org.id));
        updated++;
        console.log(`  ${org.name}: ${coords.lat}, ${coords.lng}`);
      }
    }

    // Count failures
    for (const postcode of batch) {
      if (!results.has(postcode)) {
        const matchingOrgs = postcodeToOrgs.get(postcode) || [];
        for (const org of matchingOrgs) {
          console.log(`  FAILED: ${org.name} (${postcode})`);
          failed++;
        }
      }
    }

    // Small delay between batches
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  console.log(`\nDone! Updated: ${updated}, Failed: ${failed}`);
  process.exit(0);
}

main().catch(console.error);

