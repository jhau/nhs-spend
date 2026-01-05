export interface OdsOrganisation {
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

/**
 * Search for an NHS organisation using the ODS API.
 * Tries multiple name variations to improve match rates.
 */
export async function searchNhsOrganisation(
  name: string
): Promise<OdsOrganisation[]> {
  const clean = (n: string) => n.replace(/—.*$/, "").trim();
  const searchName = clean(name);

  // Try variations in order of likelihood
  const searchTerms = [
    searchName,
    searchName.replace(/&/g, "and"),
    searchName.replace(/\bICB\b/gi, "Integrated Care Board"),
    searchName
      .replace(/&/g, "and")
      .replace(/\bICB\b/gi, "Integrated Care Board"),
  ];

  // Unique search terms to avoid duplicate API calls
  const uniqueTerms = Array.from(new Set(searchTerms));
  const allOrganisations: OdsOrganisation[] = [];
  const seenIds = new Set<string>();

  for (const term of uniqueTerms) {
    const url = `https://directory.spineservices.nhs.uk/ORD/2-0-0/organisations?Name=${encodeURIComponent(
      term
    )}&Status=Active`;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        continue;
      }

      const data: OdsResponse = await response.json();

      if (data.Organisations && data.Organisations.length > 0) {
        for (const org of data.Organisations) {
          if (!seenIds.has(org.OrgId)) {
            allOrganisations.push(org);
            seenIds.add(org.OrgId);
          }
        }
      }
    } catch (error) {
      console.error(`Error searching NHS ODS for "${term}":`, error);
      continue;
    }
  }

  return allOrganisations;
}

/**
 * Checks if a name is likely an NHS organisation.
 */
export function isLikelyNhsOrganisation(name: string): boolean {
  const lowerName = name.toLowerCase();

  // 1. Exclude purely numeric or reference-like names
  if (/^\d+(\.\d+)?$/.test(name.trim())) return false;

  // 2. Exclude obvious supply chain / product categories / framework names
  const productKeywords = [
    "wound care",
    "products",
    "devices",
    "consumables",
    "equipment",
    "solutions",
    "lot ",
    "services 20",
    "systems",
    "lancets",
    "bags",
    "therapy",
    "implants",
    "stimulators",
    "pumps",
    "monitoring",
    "hygiene",
    "packs",
    "testing",
    "fixation",
    "bulking",
    "urology",
    "vascular",
    "orthopaedic",
    "orthoses",
    "podiatry",
    "handling",
    "components",
    "obstetrics",
    "gynaecological",
    "ppe",
    "surgical",
    "sutures",
    "adhesives",
    "cuffs",
    "thermometer",
    "catheters",
    "batteries",
    "torches",
    "diagnostics",
    "maintenance",
    "repair",
    "gels",
    "defibrillation",
    "sleep",
    "pressure area",
  ];

  if (productKeywords.some((keyword) => lowerName.includes(keyword))) {
    return false;
  }

  // 3. Exclude internal departments or generic roles
  const internalKeywords = [
    "ACS ",
    "CORPORATE ESTATES",
    "DIGITAL SERVICES",
    "INPATIENTS",
    "LOCALITY",
    "FINANCE",
    "MEDICAL",
    "ADMINISTRATION",
  ];

  if (internalKeywords.some((keyword) => name.includes(keyword))) {
    return false;
  }

  // 4. Include if contains specific NHS indicators
  const nhsIndicators = [
    "nhs",
    "hospital",
    "trust",
    " icb",
    " ccg",
    "healthcare",
    "integrated care board",
    "foundation trust",
  ];

  return nhsIndicators.some((indicator) => lowerName.includes(indicator));
}
