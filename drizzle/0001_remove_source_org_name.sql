-- Remove redundant source_org_name column from spend_entries
-- Organisation name is already available via the organisationId foreign key
ALTER TABLE "spend_entries" DROP COLUMN "source_org_name";


