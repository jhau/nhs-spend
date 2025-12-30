import fs from "fs";
import path from "path";
import { read, utils } from "xlsx";
import stringSimilarity from "string-similarity";

/**
 * Metadata for a council retrieved from external APIs.
 */
export interface CouncilMetadata {
  name: string;
  officialName: string;
  gssCode?: string;
  onsCode?: string;
  councilType: string;
  tier?: string;
  homepageUrl?: string;
  region?: string;
  nation?: string;
  population?: number;
  latitude?: number;
  longitude?: number;
}

// Cache for local council data
let localCouncilsCache: any[] | null = null;

/**
 * Load local council data from CSV.
 */
export function getLocalCouncils() {
  if (localCouncilsCache) return localCouncilsCache;

  const csvPath = path.join(
    process.cwd(),
    "data/council/Local_Authority_Districts_December_2023_Boundaries_UK_BFC_3975128911846889050.csv"
  );

  try {
    const fileBuffer = fs.readFileSync(csvPath);
    const workbook = read(fileBuffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    localCouncilsCache = utils.sheet_to_json(sheet);
    return localCouncilsCache;
  } catch (error) {
    console.error("Error loading local council CSV:", error);
    return [];
  }
}

/**
 * Search for council metadata by name using local CSV and Gov.uk APIs.
 */
export async function searchCouncilMetadata(
  name: string
): Promise<CouncilMetadata | null> {
  const normalizedName = name.replace(/\s+/gu, " ").trim();

  try {
    // 1. Try to find GSS code and official name from local CSV
    const localResult = lookupLocalGeography(normalizedName);

    if (!localResult) {
      return null;
    }

    // 2. Try to find homepage and additional details from Gov.uk for verified councils
    const govUkDetails = await lookupGovUkMetadata(localResult.officialName);

    return {
      name: normalizedName,
      officialName: localResult.officialName,
      gssCode: localResult.gssCode,
      onsCode: localResult.onsCode,
      councilType: localResult.type || govUkDetails?.type || "unknown",
      tier: govUkDetails?.tier,
      homepageUrl: govUkDetails?.homepageUrl,
      region: localResult.region,
      nation: localResult.nation || "England",
    };
  } catch (error) {
    console.error(`Error fetching council metadata for ${name}:`, error);
    return null;
  }
}

/**
 * Look up official GSS code and geography data from local CSV.
 */
function lookupLocalGeography(name: string) {
  const councils = getLocalCouncils();
  if (!councils || councils.length === 0) return null;

  // Clean name for query - remove common suffixes for better search
  const cleanName = name
    .replace(
      /\b(District|Borough|City|County|Metropolitan|London Borough)?\s*Council\b/gi,
      ""
    )
    .replace(/\b(National Park|Authority)\b/gi, "")
    .trim();

  // Find the best match among local results
  const matches = councils
    .map((c: any) => {
      const officialName = c.LAD23NM;
      if (!officialName) return { similarity: 0 };

      // Exclude things that are clearly not the council we are looking for
      if (
        officialName.toLowerCase().includes("national park") ||
        officialName.toLowerCase().includes("authority")
      ) {
        return { officialName, similarity: 0 };
      }

      // Compare against BOTH the full name and the clean name
      const simFull = stringSimilarity.compareTwoStrings(
        name.toLowerCase(),
        officialName.toLowerCase()
      );
      const simClean = stringSimilarity.compareTwoStrings(
        cleanName.toLowerCase(),
        officialName.toLowerCase()
      );

      return {
        officialName,
        gssCode: c.LAD23CD,
        onsCode: c.LAD23CD,
        latitude: c.LAT ? Number(c.LAT) : undefined,
        longitude: c.LONG ? Number(c.LONG) : undefined,
        similarity: Math.max(simFull, simClean),
      };
    })
    .filter((m) => m.similarity > 0);

  if (matches.length === 0) return null;

  matches.sort((a: any, b: any) => b.similarity - a.similarity);

  const bestMatch = matches[0];

  if (bestMatch.similarity > 0.7) {
    return {
      officialName: bestMatch.officialName,
      gssCode: bestMatch.gssCode,
      onsCode: bestMatch.onsCode,
      latitude: bestMatch.latitude,
      longitude: bestMatch.longitude,
      type: inferCouncilType(bestMatch.officialName),
      nation: inferNation(bestMatch.gssCode),
      region: undefined as string | undefined,
    };
  }

  return null;
}

/**
 * Look up metadata like homepage URL from Gov.uk Organisations API.
 */
async function lookupGovUkMetadata(name: string) {
  // Use the search API to find the organization
  const searchUrl = `https://www.gov.uk/api/search.json?filter_organisations=${encodeURIComponent(
    name.toLowerCase().replace(/\s+/g, "-")
  )}&fields=title,link,organisation_state,organisation_type`;

  try {
    const searchResp = await fetch(searchUrl);
    if (!searchResp.ok) return null;

    const searchData = await searchResp.json();
    let bestMatch = null;

    if (searchData.results && searchData.results.length > 0) {
      // Find the first result that looks like a council
      bestMatch = searchData.results.find((r: any) => {
        const type = (r.organisation_type || "").toLowerCase();
        const title = (r.title || "").toLowerCase();

        // Strict exclusion of non-council bodies often returned in fuzzy searches
        if (
          title.includes("national park") ||
          title.includes("police") ||
          title.includes("fire") ||
          title.includes("committee") ||
          title.includes("commission")
        ) {
          return false;
        }

        return type === "local_authority" || title.includes("council");
      });
    }

    if (!bestMatch) {
      // Try a broader search if the direct filter fails
      const broaderUrl = `https://www.gov.uk/api/search.json?q=${encodeURIComponent(
        name
      )}&filter_format=organisation&fields=title,link,organisation_type`;
      const broadResp = await fetch(broaderUrl);
      if (!broadResp.ok) return null;
      const broadData = await broadResp.json();
      if (!broadData.results || broadData.results.length === 0) return null;

      // Again, find the first result that looks like a council
      bestMatch = broadData.results.find((r: any) => {
        const type = (r.organisation_type || "").toLowerCase();
        const title = (r.title || "").toLowerCase();

        if (
          title.includes("national park") ||
          title.includes("police") ||
          title.includes("fire") ||
          title.includes("committee") ||
          title.includes("commission")
        ) {
          return false;
        }

        return type === "local_authority" || title.includes("council");
      });
    }

    if (!bestMatch || !bestMatch.link.includes("/government/organisations/")) {
      return null;
    }

    // Now fetch the full organization details
    const orgSlug = bestMatch.link.replace("/government/organisations/", "");
    const orgUrl = `https://www.gov.uk/api/organisations/${orgSlug}`;

    const orgResp = await fetch(orgUrl);
    if (!orgResp.ok) return null;

    const orgData = await orgResp.json();

    return {
      officialName: orgData.title,
      homepageUrl: orgData.web_url,
      type: orgData.details?.organisation_type || "local_authority",
      tier: inferTierFromType(orgData.details?.organisation_type || ""),
    };
  } catch (e) {
    console.warn("Gov.uk API lookup failed:", e);
  }

  return null;
}

function inferCouncilType(name: string): string {
  const n = name.toLowerCase();
  if (n.includes("city of") || n.includes("city council")) return "city";
  if (n.includes("london borough")) return "london_borough";
  if (n.includes("metropolitan borough")) return "metropolitan";
  if (n.includes("district council")) return "district";
  if (n.includes("county council")) return "county";
  return "unitary";
}

function inferTierFromType(type: string): string {
  if (type.includes("county")) return "tier1";
  if (type.includes("district")) return "tier2";
  return "unitary";
}

function inferNation(gssCode: string): string {
  if (gssCode.startsWith("E")) return "England";
  if (gssCode.startsWith("W")) return "Wales";
  if (gssCode.startsWith("S")) return "Scotland";
  if (gssCode.startsWith("N")) return "Northern Ireland";
  return "England";
}
