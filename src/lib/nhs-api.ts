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
 */
export async function searchNhsOrganisation(
  name: string
): Promise<OdsOrganisation[]> {
  // Clean up the name for search but keep descriptive terms for better precision
  const searchName = name
    .replace(/—.*$/, "") // Remove notes like "—merged into MSE"
    .trim();

  const url = `https://directory.spineservices.nhs.uk/ORD/2-0-0/organisations?Name=${encodeURIComponent(
    searchName
  )}&Status=Active`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.error(`NHS ODS API failed for "${searchName}": ${response.status}`);
      return [];
    }

    const data: OdsResponse = await response.json();
    
    if (!data.Organisations) return [];

    // Return all organizations, the caller can decide which one to use
    return data.Organisations;
  } catch (error) {
    console.error(`Error searching NHS ODS for "${searchName}":`, error);
    return [];
  }
}

