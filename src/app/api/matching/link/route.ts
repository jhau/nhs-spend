import { db } from "@/db";
import { suppliers, companies } from "@/db/schema";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getCompanyProfile } from "@/lib/companies-house";

export async function POST(req: Request) {
  const { supplierId, companyNumber, matchConfidence } = await req.json();
  const apiKey = process.env.COMPANIES_HOUSE_API_KEY;

  if (!supplierId) {
    return NextResponse.json({ error: "supplierId is required" }, { status: 400 });
  }

  // If no companyNumber, we mark as no_match
  if (!companyNumber) {
    await db.update(suppliers)
      .set({
        matchStatus: "no_match",
        manuallyVerified: true,
        updatedAt: new Date()
      })
      .where(eq(suppliers.id, supplierId));
    
    return NextResponse.json({ success: true });
  }

  try {
    // 1. Check if company already exists in our DB
    let company = await db.select()
      .from(companies)
      .where(eq(companies.companyNumber, companyNumber))
      .limit(1);

    let companyId: number;

    if (company.length > 0) {
      companyId = company[0].id;
    } else {
      if (!apiKey) {
        return NextResponse.json({ error: "API key not configured" }, { status: 500 });
      }

      // 2. Fetch full profile from Companies House
      const profile = await getCompanyProfile(companyNumber, apiKey);

      // 3. Save company
      const inserted = await db.insert(companies).values({
        companyNumber: profile.company_number,
        companyName: profile.company_name,
        companyStatus: profile.company_status,
        companyType: profile.type,
        dateOfCreation: profile.date_of_creation || null,
        jurisdiction: profile.jurisdiction || null,
        addressLine1: profile.registered_office_address?.address_line_1 || null,
        addressLine2: profile.registered_office_address?.address_line_2 || null,
        locality: profile.registered_office_address?.locality || null,
        postalCode: profile.registered_office_address?.postal_code || null,
        country: profile.registered_office_address?.country || null,
        sicCodes: profile.sic_codes || null,
        previousNames: profile.previous_names || null,
        rawData: profile,
        etag: profile.etag || null,
        fetchedAt: new Date(),
      }).returning({ id: companies.id });

      companyId = inserted[0].id;
    }

    // 4. Link supplier
    await db.update(suppliers)
      .set({
        companyId,
        matchStatus: "matched",
        matchConfidence: matchConfidence ? String(matchConfidence) : null,
        manuallyVerified: true,
        updatedAt: new Date()
      })
      .where(eq(suppliers.id, supplierId));

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Error linking supplier:", error);
    return NextResponse.json({ error: error.message || "Failed to link supplier" }, { status: 500 });
  }
}
