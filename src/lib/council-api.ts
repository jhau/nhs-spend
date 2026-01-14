import fs from "fs";
import path from "path";
import { read, utils } from "xlsx";
import stringSimilarity from "string-similarity";

// =============================================================================
// Types
// =============================================================================

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
  /** GSS code of the parent authority (e.g., LAD for parish, county for LAD) */
  parentGssCode?: string;
  rawData?: Record<string, any>;
}

/**
 * Response from Open Geography Portal ArcGIS REST API
 */
interface ArcGISQueryResponse {
  features?: Array<{
    attributes: Record<string, unknown>;
    geometry?: {
      x: number;
      y: number;
    };
  }>;
}

// =============================================================================
// Constants
// =============================================================================

const OPEN_GEOGRAPHY_BASE =
  "https://services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services";

// API endpoints for different geography types (using December 2024 datasets)
const ENDPOINTS = {
  // Parish boundaries (England & Wales)
  parishes: `${OPEN_GEOGRAPHY_BASE}/PAR_DEC_2024_EW_NC/FeatureServer/0/query`,
  // Local Authority Districts (UK)
  lads: `${OPEN_GEOGRAPHY_BASE}/LAD_DEC_2024_UK_NC/FeatureServer/0/query`,
  // Counties (England only)
  counties: `${OPEN_GEOGRAPHY_BASE}/CTY_DEC_2024_EN_NC/FeatureServer/0/query`,
  // Parish to LAD lookup
  parishToLad: `${OPEN_GEOGRAPHY_BASE}/PAR24_LAD24_EW_LU/FeatureServer/0/query`,
  // LAD to County lookup
  ladToCounty: `${OPEN_GEOGRAPHY_BASE}/LAD24_CTY24_EN_LU/FeatureServer/0/query`,
};

// Cache for local council data from CSV
let localCouncilsCache: any[] | null = null;

// =============================================================================
// Local CSV Lookup (existing LAD data)
// =============================================================================

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
    .replace(/\bSt\.?\b/gi, "St")
    .replace(/[.,]/g, "")
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
        originalRow: c,
      };
    })
    .filter((m) => m.similarity > 0);

  if (matches.length === 0) return null;

  matches.sort((a: any, b: any) => b.similarity - a.similarity);

  const bestMatch = matches[0];

  if (bestMatch.similarity > 0.8) {
    return {
      officialName: bestMatch.officialName,
      gssCode: bestMatch.gssCode,
      onsCode: bestMatch.onsCode,
      latitude: bestMatch.latitude,
      longitude: bestMatch.longitude,
      type: inferCouncilTypeFromName(bestMatch.officialName),
      nation: inferNation(bestMatch.gssCode),
      region: undefined as string | undefined,
      rawData: bestMatch.originalRow,
    };
  }

  console.info(
    `[lookupLocalGeography] Best match below threshold: ${
      bestMatch.officialName
    } (${(bestMatch.similarity * 100).toFixed(1)}%)`,
    {
      query: name,
    }
  );

  return null;
}

// =============================================================================
// Open Geography Portal API
// =============================================================================

/**
 * Query the Open Geography Portal ArcGIS REST API.
 */
async function queryOpenGeography(
  endpoint: string,
  where: string,
  outFields: string = "*"
): Promise<ArcGISQueryResponse | null> {
  const params = new URLSearchParams({
    where,
    outFields,
    returnGeometry: "true",
    f: "json",
  });

  try {
    const url = `${endpoint}?${params.toString()}`;
    console.info(`[queryOpenGeography] Fetching: ${url}`);
    const resp = await fetch(url);
    if (!resp.ok) {
      console.warn(
        `Open Geography API error: ${resp.status} ${resp.statusText} for URL: ${url}`
      );
      return null;
    }
    return await resp.json();
  } catch (error) {
    console.warn(`Open Geography API request failed for URL: ${endpoint}. Error: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/**
 * Search for a parish/town council in the Open Geography Portal.
 */
async function searchParish(name: string): Promise<{
  gssCode: string;
  officialName: string;
  lat?: number;
  lng?: number;
  apiAttributes?: Record<string, any>;
} | null> {
  // Clean the name for search
  const cleanName = name
    .replace(/\b(Town|Parish|Community)\s*Council\b/gi, "")
    .trim();

  // Create a flexible search pattern (e.g., "Capel St Mary" -> "CAPEL%ST%MARY")
  const searchPattern = cleanName
    .toUpperCase()
    .replace(/\bST\.?\b/g, "ST%")
    .replace(/\s+/g, "%")
    .replace(/'/g, "''");

  // Try exact match first, then flexible LIKE search
  const queries = [
    `UPPER(PAR24NM) = '${cleanName.toUpperCase().replace(/'/g, "''")}'`,
    `UPPER(PAR24NM) LIKE '${searchPattern}%'`,
  ];

  for (const where of queries) {
    const result = await queryOpenGeography(ENDPOINTS.parishes, where);
    if (result?.features && result.features.length > 0) {
      const feature = result.features[0];
      const attrs = feature.attributes;
      return {
        gssCode: attrs.PAR24CD as string,
        officialName: attrs.PAR24NM as string,
        lat: feature.geometry?.y,
        lng: feature.geometry?.x,
        apiAttributes: attrs,
      };
    }
  }

  return null;
}

/**
 * Search for a Local Authority District in the Open Geography Portal.
 */
async function searchLAD(name: string): Promise<{
  gssCode: string;
  officialName: string;
  lat?: number;
  lng?: number;
  apiAttributes?: Record<string, any>;
} | null> {
  // Clean the name for search
  const cleanName = name
    .replace(
      /\b(District|Borough|City|County|Metropolitan|London Borough)?\s*Council\b/gi,
      ""
    )
    .trim();

  // Create a flexible search pattern
  const searchPattern = cleanName
    .toUpperCase()
    .replace(/\bST\.?\b/g, "ST%")
    .replace(/\s+/g, "%")
    .replace(/'/g, "''");

  // Try exact match first, then flexible LIKE search
  const queries = [
    `UPPER(LAD24NM) = '${cleanName.toUpperCase().replace(/'/g, "''")}'`,
    `UPPER(LAD24NM) LIKE '${searchPattern}%'`,
  ];

  for (const where of queries) {
    const result = await queryOpenGeography(ENDPOINTS.lads, where);
    if (result?.features && result.features.length > 0) {
      const feature = result.features[0];
      const attrs = feature.attributes;
      return {
        gssCode: attrs.LAD24CD as string,
        officialName: attrs.LAD24NM as string,
        lat: feature.geometry?.y,
        lng: feature.geometry?.x,
        apiAttributes: attrs,
      };
    }
  }

  return null;
}

/**
 * Search for a County in the Open Geography Portal.
 */
async function searchCounty(name: string): Promise<{
  gssCode: string;
  officialName: string;
  lat?: number;
  lng?: number;
  apiAttributes?: Record<string, any>;
} | null> {
  // Clean the name for search
  const cleanName = name.replace(/\b(County)?\s*Council\b/gi, "").trim();

  // Create a flexible search pattern
  const searchPattern = cleanName
    .toUpperCase()
    .replace(/\bST\.?\b/g, "ST%")
    .replace(/\s+/g, "%")
    .replace(/'/g, "''");

  // Try exact match first, then flexible LIKE search
  const queries = [
    `UPPER(CTY24NM) = '${cleanName.toUpperCase().replace(/'/g, "''")}'`,
    `UPPER(CTY24NM) LIKE '${searchPattern}%'`,
  ];

  for (const where of queries) {
    const result = await queryOpenGeography(ENDPOINTS.counties, where);
    if (result?.features && result.features.length > 0) {
      const feature = result.features[0];
      const attrs = feature.attributes;
      return {
        gssCode: attrs.CTY24CD as string,
        officialName: attrs.CTY24NM as string,
        lat: feature.geometry?.y,
        lng: feature.geometry?.x,
        apiAttributes: attrs,
      };
    }
  }

  return null;
}

/**
 * Look up the parent LAD for a parish using the lookup table.
 */
export async function lookupParishParentLAD(
  parishGssCode: string
): Promise<{ gssCode: string; name: string } | null> {
  const where = `PAR24CD = '${parishGssCode.replace(/'/g, "''")}'`;
  const result = await queryOpenGeography(ENDPOINTS.parishToLad, where);

  if (result?.features && result.features.length > 0) {
    const attrs = result.features[0].attributes;
    return {
      gssCode: attrs.LAD24CD as string,
      name: attrs.LAD24NM as string,
    };
  }

  return null;
}

/**
 * Look up the parent County for a LAD using the lookup table.
 */
export async function lookupLADParentCounty(
  ladGssCode: string
): Promise<{ gssCode: string; name: string } | null> {
  const where = `LAD24CD = '${ladGssCode.replace(/'/g, "''")}'`;
  const result = await queryOpenGeography(ENDPOINTS.ladToCounty, where);

  if (result?.features && result.features.length > 0) {
    const attrs = result.features[0].attributes;
    // Some LADs don't have a county (unitary authorities)
    if (attrs.CTY24CD && attrs.CTY24CD !== "E99999999") {
      return {
        gssCode: attrs.CTY24CD as string,
        name: attrs.CTY24NM as string,
      };
    }
  }

  return null;
}

/**
 * Search the Open Geography Portal for any type of council.
 * Tries parish first, then LAD, then county.
 */
async function searchOpenGeographyPortal(
  name: string
): Promise<CouncilMetadata | null> {
  const normalizedName = name.replace(/\s+/gu, " ").trim();
  const lowerName = normalizedName.toLowerCase();

  // Determine likely type from name
  const isParish =
    lowerName.includes("town council") ||
    lowerName.includes("parish council") ||
    lowerName.includes("community council");
  const isCounty =
    lowerName.includes("county council") && !lowerName.includes("district");

  // Try parish first if it looks like one
  if (isParish) {
    console.debug(
      `[searchOpenGeographyPortal] Attempting parish search for ${normalizedName}`
    );
    const parish = await searchParish(normalizedName);
    if (parish) {
      // Look up parent LAD
      const parentLad = await lookupParishParentLAD(parish.gssCode);
      return {
        name: normalizedName,
        officialName: parish.officialName,
        gssCode: parish.gssCode,
        onsCode: parish.gssCode,
        councilType: inferCouncilTypeFromName(normalizedName),
        tier: "tier3",
        nation: inferNation(parish.gssCode),
        latitude: parish.lat,
        longitude: parish.lng,
        parentGssCode: parentLad?.gssCode,
        rawData: parish.apiAttributes,
      };
    }
  }

  // Try county if it looks like one
  if (isCounty) {
    console.debug(
      `[searchOpenGeographyPortal] Attempting county search for ${normalizedName}`
    );
    const county = await searchCounty(normalizedName);
    if (county) {
      return {
        name: normalizedName,
        officialName: county.officialName,
        gssCode: county.gssCode,
        onsCode: county.gssCode,
        councilType: "county",
        tier: "tier1",
        nation: inferNation(county.gssCode),
        latitude: county.lat,
        longitude: county.lng,
        rawData: county.apiAttributes,
      };
    }
  }

  // Try LAD
  console.debug(
    `[searchOpenGeographyPortal] Attempting LAD search for ${normalizedName}`
  );
  const lad = await searchLAD(normalizedName);
  if (lad) {
    // Look up parent county (may not exist for unitary authorities)
    const parentCounty = await lookupLADParentCounty(lad.gssCode);
    return {
      name: normalizedName,
      officialName: lad.officialName,
      gssCode: lad.gssCode,
      onsCode: lad.gssCode,
      councilType: inferCouncilTypeFromName(lad.officialName),
      tier: parentCounty ? "tier2" : "unitary",
      nation: inferNation(lad.gssCode),
      latitude: lad.lat,
      longitude: lad.lng,
      parentGssCode: parentCounty?.gssCode,
      rawData: lad.apiAttributes,
    };
  }

  // If nothing found and it looked like a parish, still return null
  // (we already tried parish above)
  if (!isParish && !isCounty) {
    // Try parish as fallback for unknown types
    console.debug(
      `[searchOpenGeographyPortal] Fallback: attempting parish search for ${normalizedName}`
    );
    const parish = await searchParish(normalizedName);
    if (parish) {
      const parentLad = await lookupParishParentLAD(parish.gssCode);
      return {
        name: normalizedName,
        officialName: parish.officialName,
        gssCode: parish.gssCode,
        onsCode: parish.gssCode,
        councilType: inferCouncilTypeFromName(normalizedName),
        tier: "tier3",
        nation: inferNation(parish.gssCode),
        latitude: parish.lat,
        longitude: parish.lng,
        parentGssCode: parentLad?.gssCode,
        rawData: parish.apiAttributes,
      };
    }

    // Try county as fallback
    console.debug(
      `[searchOpenGeographyPortal] Fallback: attempting county search for ${normalizedName}`
    );
    const county = await searchCounty(normalizedName);
    if (county) {
      return {
        name: normalizedName,
        officialName: county.officialName,
        gssCode: county.gssCode,
        onsCode: county.gssCode,
        councilType: "county",
        tier: "tier1",
        nation: inferNation(county.gssCode),
        latitude: county.lat,
        longitude: county.lng,
        rawData: county.apiAttributes,
      };
    }
  }

  return null;
}

// =============================================================================
// Gov.uk API (for homepage URLs)
// =============================================================================

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
    if (!searchResp.ok) {
      console.warn(`Gov.uk search failed: ${searchResp.status} ${searchResp.statusText} for URL: ${searchUrl}`);
      return null;
    }

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
      if (!broadResp.ok) {
        console.warn(`Gov.uk broad search failed: ${broadResp.status} ${broadResp.statusText} for URL: ${broaderUrl}`);
        return null;
      }
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
    if (!orgResp.ok) {
      console.warn(`Gov.uk org lookup failed: ${orgResp.status} ${orgResp.statusText} for URL: ${orgUrl}`);
      return null;
    }

    const orgData = await orgResp.json();

    return {
      officialName: orgData.title,
      homepageUrl: orgData.web_url,
      type: orgData.details?.organisation_type || "local_authority",
      tier: inferTierFromType(orgData.details?.organisation_type || ""),
    };
  } catch (e) {
    console.warn(`Gov.uk API lookup failed for organisation "${name}". Error: ${e instanceof Error ? e.message : String(e)}`);
  }

  return null;
}

// =============================================================================
// Main Search Function
// =============================================================================

/**
 * Search for council metadata by name.
 * Tries local CSV first, then falls back to Open Geography Portal API.
 */
export async function searchCouncilMetadata(
  name: string
): Promise<CouncilMetadata | null> {
  const normalizedName = name.replace(/\s+/gu, " ").trim();

  // Heuristic: If it looks like a company or doesn't look like a council, skip it
  const lowerName = normalizedName.toLowerCase();

  // Check if it's explicitly a county council (Tier 1)
  const isLikelyCounty =
    lowerName.includes("county council") &&
    !lowerName.includes("district") &&
    !lowerName.includes("borough");

  const hasCouncilKeyword =
    lowerName.includes("council") ||
    lowerName.includes("authority") ||
    lowerName.includes("borough") ||
    lowerName.includes("district") ||
    lowerName.includes("parish");

  const hasCompanySuffix =
    /\b(ltd|limited|plc|llp|inc|corp|corporation)\b/i.test(lowerName);

  if (hasCompanySuffix || (!hasCouncilKeyword && normalizedName.length > 50)) {
    console.debug("[searchCouncilMetadata] Skipping obvious non-council name", {
      name: normalizedName,
    });
    return null;
  }

  try {
    console.info("[searchCouncilMetadata] Starting lookup", {
      query: normalizedName,
    });

    // 1. If it's likely a county, try Open Geography first to avoid incorrect LAD matches
    if (isLikelyCounty) {
      console.info(
        "[searchCouncilMetadata] Likely county, checking Open Geography API first",
        { query: normalizedName }
      );
      const apiResult = await searchOpenGeographyPortal(normalizedName);
      if (apiResult && apiResult.councilType === "county") {
        console.info(
          "[searchCouncilMetadata] Matched County via Open Geography API",
          {
            query: normalizedName,
            match: apiResult.officialName,
            gssCode: apiResult.gssCode,
          }
        );

        // Try to get homepage URL from Gov.uk
        const govUkDetails = await lookupGovUkMetadata(apiResult.officialName);
        if (govUkDetails?.homepageUrl) {
          apiResult.homepageUrl = govUkDetails.homepageUrl;
        }
        return apiResult;
      }
    }

    // 2. Try to find GSS code and official name from local CSV (LADs only)
    const localResult = lookupLocalGeography(normalizedName);

    if (localResult) {
      console.info("[searchCouncilMetadata] Matched via local CSV", {
        query: normalizedName,
        match: localResult.officialName,
        gssCode: localResult.gssCode,
      });

      // Found in CSV - try to get homepage and parent county from APIs
      const govUkDetails = await lookupGovUkMetadata(localResult.officialName);
      const parentCounty = localResult.gssCode
        ? await lookupLADParentCounty(localResult.gssCode)
        : null;

      return {
        name: normalizedName,
        officialName: localResult.officialName,
        gssCode: localResult.gssCode,
        onsCode: localResult.onsCode,
        councilType: localResult.type || govUkDetails?.type || "unknown",
        tier: parentCounty ? "tier2" : govUkDetails?.tier || "unitary",
        homepageUrl: govUkDetails?.homepageUrl,
        region: localResult.region,
        nation: localResult.nation || "England",
        latitude: localResult.latitude,
        longitude: localResult.longitude,
        parentGssCode: parentCounty?.gssCode,
        rawData: localResult.rawData as Record<string, any>,
      };
    }

    console.info(
      "[searchCouncilMetadata] Local CSV miss, checking Open Geography API",
      { query: normalizedName }
    );

    // 2. Not found in CSV - try Open Geography Portal API
    const apiResult = await searchOpenGeographyPortal(normalizedName);
    if (apiResult) {
      console.info("[searchCouncilMetadata] Matched via Open Geography API", {
        query: normalizedName,
        match: apiResult.officialName,
        gssCode: apiResult.gssCode,
        councilType: apiResult.councilType,
      });

      // Try to get homepage URL from Gov.uk
      const govUkDetails = await lookupGovUkMetadata(apiResult.officialName);
      if (govUkDetails?.homepageUrl) {
        apiResult.homepageUrl = govUkDetails.homepageUrl;
      }
      return apiResult;
    }

    console.warn("[searchCouncilMetadata] No council match found", {
      query: normalizedName,
    });
    return null;
  } catch (error) {
    console.error("[searchCouncilMetadata] Lookup failed", {
      query: normalizedName,
      error:
        error instanceof Error
          ? { message: error.message, stack: error.stack }
          : String(error),
    });
    return null;
  }
}

/**
 * Look up a council by its GSS code.
 */
export async function lookupCouncilByGssCode(
  gssCode: string
): Promise<CouncilMetadata | null> {
  // Determine type from GSS code prefix
  const prefix = gssCode.substring(0, 3);

  try {
    // Parish codes start with E04 (England) or W04 (Wales)
    if (prefix === "E04" || prefix === "W04") {
      const where = `PAR24CD = '${gssCode}'`;
      const result = await queryOpenGeography(ENDPOINTS.parishes, where);
      if (result?.features && result.features.length > 0) {
        const attrs = result.features[0].attributes;
        const parentLad = await lookupParishParentLAD(gssCode);
        return {
          name: attrs.PAR24NM as string,
          officialName: attrs.PAR24NM as string,
          gssCode,
          onsCode: gssCode,
          councilType: "parish",
          tier: "tier3",
          nation: inferNation(gssCode),
          latitude: result.features[0].geometry?.y,
          longitude: result.features[0].geometry?.x,
          parentGssCode: parentLad?.gssCode,
          rawData: attrs,
        };
      }
    }

    // County codes start with E10
    if (prefix === "E10") {
      const where = `CTY24CD = '${gssCode}'`;
      const result = await queryOpenGeography(ENDPOINTS.counties, where);
      if (result?.features && result.features.length > 0) {
        const attrs = result.features[0].attributes;
        return {
          name: attrs.CTY24NM as string,
          officialName: attrs.CTY24NM as string,
          gssCode,
          onsCode: gssCode,
          councilType: "county",
          tier: "tier1",
          nation: "England",
          latitude: result.features[0].geometry?.y,
          longitude: result.features[0].geometry?.x,
          rawData: attrs,
        };
      }
    }

    // LAD codes - various prefixes (E06, E07, E08, E09, W06, S12, N09, etc.)
    const where = `LAD24CD = '${gssCode}'`;
    const result = await queryOpenGeography(ENDPOINTS.lads, where);
    if (result?.features && result.features.length > 0) {
      const attrs = result.features[0].attributes;
      const parentCounty = await lookupLADParentCounty(gssCode);
      return {
        name: attrs.LAD24NM as string,
        officialName: attrs.LAD24NM as string,
        gssCode,
        onsCode: gssCode,
        councilType: inferCouncilTypeFromGssCode(gssCode),
        tier: parentCounty ? "tier2" : "unitary",
        nation: inferNation(gssCode),
        latitude: result.features[0].geometry?.y,
        longitude: result.features[0].geometry?.x,
        parentGssCode: parentCounty?.gssCode,
        rawData: attrs,
      };
    }

    return null;
  } catch (error) {
    console.error(`Error looking up council by GSS code ${gssCode}:`, error);
    return null;
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

function inferCouncilTypeFromName(name: string): string {
  const n = name.toLowerCase();
  if (n.includes("town council")) return "town";
  if (n.includes("parish council")) return "parish";
  if (n.includes("community council")) return "community";
  if (n.includes("city of") || n.includes("city council")) return "city";
  if (n.includes("london borough")) return "london_borough";
  if (n.includes("metropolitan borough")) return "metropolitan";
  if (n.includes("district council")) return "district";
  if (n.includes("county council")) return "county";
  if (n.includes("borough council")) return "borough";
  return "unitary";
}

function inferCouncilTypeFromGssCode(gssCode: string): string {
  const prefix = gssCode.substring(0, 3);
  switch (prefix) {
    case "E06":
      return "unitary"; // Unitary authorities
    case "E07":
      return "district"; // Non-metropolitan districts
    case "E08":
      return "metropolitan"; // Metropolitan districts
    case "E09":
      return "london_borough"; // London boroughs
    case "E10":
      return "county"; // Counties
    case "W06":
      return "unitary"; // Welsh unitary authorities
    case "S12":
      return "unitary"; // Scottish council areas
    case "N09":
      return "district"; // Northern Ireland districts
    default:
      return "unknown";
  }
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
