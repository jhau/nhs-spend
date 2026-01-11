# Database Schema Reference

Generated: 2026-01-11T07:34:47.217Z

## Tables Overview

| Table | Rows | Size |
|-------|------|------|
| audit_log | 0 | 40 kB |
| buyers | 478 | 296 kB |
| companies | 11345 | 21 MB |
| contract_supplier_searches | 0 | 32 kB |
| contracts | 0 | 40 kB |
| councils | 234 | 248 kB |
| entities | 11901 | 4160 kB |
| government_departments | 32 | 120 kB |
| nhs_organisations | 285 | 128 kB |
| pipeline_assets | 27 | 80 kB |
| pipeline_run_logs | 12409 | 3504 kB |
| pipeline_run_stages | 40 | 112 kB |
| pipeline_runs | 20 | 80 kB |
| pipeline_skipped_rows | 281660 | 54 MB |
| spend_entries | 5348128 | 2129 MB |
| suppliers | 74329 | 17 MB |

## Table Columns

### audit_log

| Column | Type | Nullable | Default |
|--------|------|----------|--------|
| id | integer | NO | nextval('audit_log_id_seq'::regclass) |
| ts | timestamp with time zone | NO | now() |
| actor_type | text | NO | - |
| actor_id | text | YES | - |
| run_id | integer | YES | - |
| stage_id | text | YES | - |
| table_name | text | NO | - |
| record_pk | text | NO | - |
| action | text | NO | - |
| before | jsonb | YES | - |
| after | jsonb | YES | - |
| reason | text | YES | - |

### buyers

| Column | Type | Nullable | Default |
|--------|------|----------|--------|
| id | integer | NO | nextval('buyers_id_seq'::regclass) |
| name | text | NO | - |
| entity_id | integer | YES | - |
| match_status | text | NO | 'pending'::text |
| match_confidence | numeric | YES | - |
| match_attempted_at | timestamp with time zone | YES | - |
| manually_verified | boolean | YES | false |
| official_website | text | YES | - |
| spending_data_url | text | YES | - |
| missing_data_note | text | YES | - |
| verified_via | text | YES | - |
| created_at | timestamp with time zone | NO | now() |
| updated_at | timestamp with time zone | NO | now() |

### companies

| Column | Type | Nullable | Default |
|--------|------|----------|--------|
| entity_id | integer | NO | - |
| company_number | text | NO | - |
| company_status | text | YES | - |
| company_type | text | YES | - |
| date_of_creation | date | YES | - |
| date_of_cessation | date | YES | - |
| jurisdiction | text | YES | - |
| sic_codes | jsonb | YES | - |
| previous_names | jsonb | YES | - |
| raw_data | jsonb | YES | - |
| etag | text | YES | - |
| fetched_at | timestamp with time zone | NO | - |

### contract_supplier_searches

| Column | Type | Nullable | Default |
|--------|------|----------|--------|
| id | integer | NO | nextval('contract_supplier_searches_id_seq'::regclass) |
| search_keyword | text | NO | - |
| contract_id | integer | NO | - |
| created_at | timestamp with time zone | NO | now() |

### contracts

| Column | Type | Nullable | Default |
|--------|------|----------|--------|
| id | integer | NO | nextval('contracts_id_seq'::regclass) |
| contract_id | text | NO | - |
| title | text | NO | - |
| description | text | YES | - |
| buyer | text | YES | - |
| published_date | timestamp with time zone | YES | - |
| awarded_date | timestamp with time zone | YES | - |
| awarded_value | numeric | YES | - |
| awarded_suppliers | jsonb | YES | - |
| cpv_description | text | YES | - |
| region | text | YES | - |
| raw_data | jsonb | YES | - |
| fetched_at | timestamp with time zone | NO | - |
| created_at | timestamp with time zone | NO | now() |

### councils

| Column | Type | Nullable | Default |
|--------|------|----------|--------|
| entity_id | integer | NO | - |
| gss_code | text | YES | - |
| ons_code | text | YES | - |
| council_type | text | NO | - |
| tier | text | YES | - |
| homepage_url | text | YES | - |
| region | text | YES | - |
| nation | text | YES | - |
| population | integer | YES | - |
| parent_entity_id | integer | YES | - |
| raw_data | jsonb | YES | - |
| fetched_at | timestamp with time zone | YES | - |

### entities

| Column | Type | Nullable | Default |
|--------|------|----------|--------|
| id | integer | NO | nextval('entities_id_seq'::regclass) |
| entity_type | text | NO | - |
| registry_id | text | NO | - |
| name | text | NO | - |
| status | text | YES | - |
| address_line_1 | text | YES | - |
| address_line_2 | text | YES | - |
| locality | text | YES | - |
| postal_code | text | YES | - |
| country | text | YES | - |
| latitude | double precision | YES | - |
| longitude | double precision | YES | - |
| ai_summary | text | YES | - |
| ai_news | jsonb | YES | - |
| ai_summary_updated_at | timestamp with time zone | YES | - |
| created_at | timestamp with time zone | NO | now() |
| updated_at | timestamp with time zone | NO | now() |

### government_departments

| Column | Type | Nullable | Default |
|--------|------|----------|--------|
| entity_id | integer | NO | - |
| slug | text | NO | - |
| acronym | text | YES | - |
| organisation_type | text | YES | - |
| organisation_state | text | YES | - |
| link | text | YES | - |
| logo_url | text | YES | - |
| raw_data | jsonb | YES | - |
| fetched_at | timestamp with time zone | YES | - |

### nhs_organisations

| Column | Type | Nullable | Default |
|--------|------|----------|--------|
| entity_id | integer | NO | - |
| ods_code | text | NO | - |
| org_type | text | NO | - |
| org_sub_type | text | YES | - |
| parent_ods_code | text | YES | - |
| region | text | YES | - |
| nhs_region | text | YES | - |
| open_date | date | YES | - |
| close_date | date | YES | - |
| is_active | boolean | YES | true |
| raw_data | jsonb | YES | - |
| fetched_at | timestamp with time zone | YES | - |

### pipeline_assets

| Column | Type | Nullable | Default |
|--------|------|----------|--------|
| id | integer | NO | nextval('pipeline_assets_id_seq'::regclass) |
| object_key | text | NO | - |
| original_name | text | NO | - |
| content_type | text | YES | - |
| size_bytes | integer | NO | - |
| checksum | text | YES | - |
| created_at | timestamp with time zone | NO | now() |

### pipeline_run_logs

| Column | Type | Nullable | Default |
|--------|------|----------|--------|
| id | integer | NO | nextval('pipeline_run_logs_id_seq'::regclass) |
| run_id | integer | NO | - |
| ts | timestamp with time zone | NO | now() |
| level | text | NO | - |
| message | text | NO | - |
| meta | jsonb | YES | - |

### pipeline_run_stages

| Column | Type | Nullable | Default |
|--------|------|----------|--------|
| id | integer | NO | nextval('pipeline_run_stages_id_seq'::regclass) |
| run_id | integer | NO | - |
| stage_id | text | NO | - |
| status | text | NO | 'queued'::text |
| started_at | timestamp with time zone | YES | - |
| finished_at | timestamp with time zone | YES | - |
| metrics | jsonb | YES | - |
| error | text | YES | - |

### pipeline_runs

| Column | Type | Nullable | Default |
|--------|------|----------|--------|
| id | integer | NO | nextval('pipeline_runs_id_seq'::regclass) |
| asset_id | integer | YES | - |
| trigger | text | NO | 'web'::text |
| created_by | text | YES | - |
| status | text | NO | 'queued'::text |
| org_type | text | NO | 'nhs'::text |
| dry_run | boolean | NO | false |
| from_stage_id | text | YES | - |
| to_stage_id | text | YES | - |
| params | jsonb | YES | - |
| started_at | timestamp with time zone | YES | - |
| finished_at | timestamp with time zone | YES | - |
| created_at | timestamp with time zone | NO | now() |

### pipeline_skipped_rows

| Column | Type | Nullable | Default |
|--------|------|----------|--------|
| id | integer | NO | nextval('pipeline_skipped_rows_id_seq'::regclass) |
| run_id | integer | NO | - |
| sheet_name | text | NO | - |
| row_number | integer | NO | - |
| reason | text | NO | - |
| raw_data | jsonb | YES | - |
| created_at | timestamp with time zone | NO | now() |

### spend_entries

| Column | Type | Nullable | Default |
|--------|------|----------|--------|
| id | integer | NO | nextval('spend_entries_id_seq'::regclass) |
| asset_id | integer | NO | - |
| raw_buyer | text | NO | - |
| buyer_id | integer | NO | - |
| raw_supplier | text | NO | - |
| supplier_id | integer | YES | - |
| amount | numeric | NO | - |
| payment_date | date | NO | - |
| raw_amount | text | YES | - |
| payment_date_raw | text | YES | - |
| source_sheet | text | NO | - |
| source_row_number | integer | NO | - |
| created_at | timestamp with time zone | NO | now() |

### suppliers

| Column | Type | Nullable | Default |
|--------|------|----------|--------|
| id | integer | NO | nextval('suppliers_id_seq'::regclass) |
| name | text | NO | - |
| entity_id | integer | YES | - |
| match_status | text | NO | 'pending'::text |
| match_confidence | numeric | YES | - |
| match_attempted_at | timestamp with time zone | YES | - |
| manually_verified | boolean | YES | false |
| created_at | timestamp with time zone | NO | now() |
| updated_at | timestamp with time zone | NO | now() |

## Indexes

- **audit_log_pkey** on `audit_log`
  ```sql
  CREATE UNIQUE INDEX audit_log_pkey ON public.audit_log USING btree (id)
  ```
- **audit_log_run_idx** on `audit_log`
  ```sql
  CREATE INDEX audit_log_run_idx ON public.audit_log USING btree (run_id)
  ```
- **audit_log_table_record_idx** on `audit_log`
  ```sql
  CREATE INDEX audit_log_table_record_idx ON public.audit_log USING btree (table_name, record_pk)
  ```
- **audit_log_ts_idx** on `audit_log`
  ```sql
  CREATE INDEX audit_log_ts_idx ON public.audit_log USING btree (ts)
  ```
- **buyers_entity_idx** on `buyers`
  ```sql
  CREATE INDEX buyers_entity_idx ON public.buyers USING btree (entity_id)
  ```
- **buyers_name_unique** on `buyers`
  ```sql
  CREATE UNIQUE INDEX buyers_name_unique ON public.buyers USING btree (name)
  ```
- **buyers_pkey** on `buyers`
  ```sql
  CREATE UNIQUE INDEX buyers_pkey ON public.buyers USING btree (id)
  ```
- **buyers_status_idx** on `buyers`
  ```sql
  CREATE INDEX buyers_status_idx ON public.buyers USING btree (match_status)
  ```
- **companies_company_number_unique** on `companies`
  ```sql
  CREATE UNIQUE INDEX companies_company_number_unique ON public.companies USING btree (company_number)
  ```
- **companies_pkey** on `companies`
  ```sql
  CREATE UNIQUE INDEX companies_pkey ON public.companies USING btree (entity_id)
  ```
- **companies_status_idx** on `companies`
  ```sql
  CREATE INDEX companies_status_idx ON public.companies USING btree (company_status)
  ```
- **contract_supplier_searches_keyword_idx** on `contract_supplier_searches`
  ```sql
  CREATE INDEX contract_supplier_searches_keyword_idx ON public.contract_supplier_searches USING btree (search_keyword)
  ```
- **contract_supplier_searches_pkey** on `contract_supplier_searches`
  ```sql
  CREATE UNIQUE INDEX contract_supplier_searches_pkey ON public.contract_supplier_searches USING btree (id)
  ```
- **contract_supplier_searches_unique** on `contract_supplier_searches`
  ```sql
  CREATE UNIQUE INDEX contract_supplier_searches_unique ON public.contract_supplier_searches USING btree (search_keyword, contract_id)
  ```
- **contracts_awarded_date_idx** on `contracts`
  ```sql
  CREATE INDEX contracts_awarded_date_idx ON public.contracts USING btree (awarded_date)
  ```
- **contracts_buyer_idx** on `contracts`
  ```sql
  CREATE INDEX contracts_buyer_idx ON public.contracts USING btree (buyer)
  ```
- **contracts_contract_id_unique** on `contracts`
  ```sql
  CREATE UNIQUE INDEX contracts_contract_id_unique ON public.contracts USING btree (contract_id)
  ```
- **contracts_pkey** on `contracts`
  ```sql
  CREATE UNIQUE INDEX contracts_pkey ON public.contracts USING btree (id)
  ```
- **councils_gss_code_unique** on `councils`
  ```sql
  CREATE UNIQUE INDEX councils_gss_code_unique ON public.councils USING btree (gss_code)
  ```
- **councils_parent_entity_idx** on `councils`
  ```sql
  CREATE INDEX councils_parent_entity_idx ON public.councils USING btree (parent_entity_id)
  ```
- **councils_pkey** on `councils`
  ```sql
  CREATE UNIQUE INDEX councils_pkey ON public.councils USING btree (entity_id)
  ```
- **councils_type_idx** on `councils`
  ```sql
  CREATE INDEX councils_type_idx ON public.councils USING btree (council_type)
  ```
- **entities_name_idx** on `entities`
  ```sql
  CREATE INDEX entities_name_idx ON public.entities USING btree (name)
  ```
- **entities_pkey** on `entities`
  ```sql
  CREATE UNIQUE INDEX entities_pkey ON public.entities USING btree (id)
  ```
- **entities_postal_code_idx** on `entities`
  ```sql
  CREATE INDEX entities_postal_code_idx ON public.entities USING btree (postal_code)
  ```
- **entities_type_idx** on `entities`
  ```sql
  CREATE INDEX entities_type_idx ON public.entities USING btree (entity_type)
  ```
- **entities_type_registry_unique** on `entities`
  ```sql
  CREATE UNIQUE INDEX entities_type_registry_unique ON public.entities USING btree (entity_type, registry_id)
  ```
- **government_departments_pkey** on `government_departments`
  ```sql
  CREATE UNIQUE INDEX government_departments_pkey ON public.government_departments USING btree (entity_id)
  ```
- **government_departments_slug_unique** on `government_departments`
  ```sql
  CREATE UNIQUE INDEX government_departments_slug_unique ON public.government_departments USING btree (slug)
  ```
- **government_departments_type_idx** on `government_departments`
  ```sql
  CREATE INDEX government_departments_type_idx ON public.government_departments USING btree (organisation_type)
  ```
- **nhs_organisations_ods_code_unique** on `nhs_organisations`
  ```sql
  CREATE UNIQUE INDEX nhs_organisations_ods_code_unique ON public.nhs_organisations USING btree (ods_code)
  ```
- **nhs_organisations_parent_idx** on `nhs_organisations`
  ```sql
  CREATE INDEX nhs_organisations_parent_idx ON public.nhs_organisations USING btree (parent_ods_code)
  ```
- **nhs_organisations_pkey** on `nhs_organisations`
  ```sql
  CREATE UNIQUE INDEX nhs_organisations_pkey ON public.nhs_organisations USING btree (entity_id)
  ```
- **nhs_organisations_type_idx** on `nhs_organisations`
  ```sql
  CREATE INDEX nhs_organisations_type_idx ON public.nhs_organisations USING btree (org_type)
  ```
- **pipeline_assets_object_key_unique** on `pipeline_assets`
  ```sql
  CREATE UNIQUE INDEX pipeline_assets_object_key_unique ON public.pipeline_assets USING btree (object_key)
  ```
- **pipeline_assets_pkey** on `pipeline_assets`
  ```sql
  CREATE UNIQUE INDEX pipeline_assets_pkey ON public.pipeline_assets USING btree (id)
  ```
- **pipeline_run_logs_pkey** on `pipeline_run_logs`
  ```sql
  CREATE UNIQUE INDEX pipeline_run_logs_pkey ON public.pipeline_run_logs USING btree (id)
  ```
- **pipeline_run_logs_run_ts_idx** on `pipeline_run_logs`
  ```sql
  CREATE INDEX pipeline_run_logs_run_ts_idx ON public.pipeline_run_logs USING btree (run_id, ts)
  ```
- **pipeline_run_stages_pkey** on `pipeline_run_stages`
  ```sql
  CREATE UNIQUE INDEX pipeline_run_stages_pkey ON public.pipeline_run_stages USING btree (id)
  ```
- **pipeline_run_stages_run_idx** on `pipeline_run_stages`
  ```sql
  CREATE INDEX pipeline_run_stages_run_idx ON public.pipeline_run_stages USING btree (run_id)
  ```
- **pipeline_run_stages_unique** on `pipeline_run_stages`
  ```sql
  CREATE UNIQUE INDEX pipeline_run_stages_unique ON public.pipeline_run_stages USING btree (run_id, stage_id)
  ```
- **pipeline_runs_asset_idx** on `pipeline_runs`
  ```sql
  CREATE INDEX pipeline_runs_asset_idx ON public.pipeline_runs USING btree (asset_id)
  ```
- **pipeline_runs_created_at_idx** on `pipeline_runs`
  ```sql
  CREATE INDEX pipeline_runs_created_at_idx ON public.pipeline_runs USING btree (created_at)
  ```
- **pipeline_runs_pkey** on `pipeline_runs`
  ```sql
  CREATE UNIQUE INDEX pipeline_runs_pkey ON public.pipeline_runs USING btree (id)
  ```
- **pipeline_runs_status_idx** on `pipeline_runs`
  ```sql
  CREATE INDEX pipeline_runs_status_idx ON public.pipeline_runs USING btree (status)
  ```
- **pipeline_skipped_rows_pkey** on `pipeline_skipped_rows`
  ```sql
  CREATE UNIQUE INDEX pipeline_skipped_rows_pkey ON public.pipeline_skipped_rows USING btree (id)
  ```
- **pipeline_skipped_rows_run_idx** on `pipeline_skipped_rows`
  ```sql
  CREATE INDEX pipeline_skipped_rows_run_idx ON public.pipeline_skipped_rows USING btree (run_id)
  ```
- **spend_entries_buyer_payment_idx** on `spend_entries`
  ```sql
  CREATE INDEX spend_entries_buyer_payment_idx ON public.spend_entries USING btree (buyer_id, payment_date)
  ```
- **spend_entries_pkey** on `spend_entries`
  ```sql
  CREATE UNIQUE INDEX spend_entries_pkey ON public.spend_entries USING btree (id)
  ```
- **spend_entries_source_row_unique** on `spend_entries`
  ```sql
  CREATE UNIQUE INDEX spend_entries_source_row_unique ON public.spend_entries USING btree (asset_id, source_sheet, source_row_number)
  ```
- **spend_entries_supplier_idx** on `spend_entries`
  ```sql
  CREATE INDEX spend_entries_supplier_idx ON public.spend_entries USING btree (supplier_id)
  ```
- **suppliers_entity_idx** on `suppliers`
  ```sql
  CREATE INDEX suppliers_entity_idx ON public.suppliers USING btree (entity_id)
  ```
- **suppliers_name_unique** on `suppliers`
  ```sql
  CREATE UNIQUE INDEX suppliers_name_unique ON public.suppliers USING btree (name)
  ```
- **suppliers_pkey** on `suppliers`
  ```sql
  CREATE UNIQUE INDEX suppliers_pkey ON public.suppliers USING btree (id)
  ```
- **suppliers_status_idx** on `suppliers`
  ```sql
  CREATE INDEX suppliers_status_idx ON public.suppliers USING btree (match_status)
  ```

## Foreign Keys

- `audit_log.run_id` → `pipeline_runs.id`
- `buyers.entity_id` → `entities.id`
- `companies.entity_id` → `entities.id`
- `contract_supplier_searches.contract_id` → `contracts.id`
- `councils.entity_id` → `entities.id`
- `councils.parent_entity_id` → `entities.id`
- `government_departments.entity_id` → `entities.id`
- `nhs_organisations.entity_id` → `entities.id`
- `pipeline_run_logs.run_id` → `pipeline_runs.id`
- `pipeline_run_stages.run_id` → `pipeline_runs.id`
- `pipeline_runs.asset_id` → `pipeline_assets.id`
- `pipeline_skipped_rows.run_id` → `pipeline_runs.id`
- `spend_entries.asset_id` → `pipeline_assets.id`
- `spend_entries.buyer_id` → `buyers.id`
- `spend_entries.supplier_id` → `suppliers.id`
- `suppliers.entity_id` → `entities.id`

## Sample Data

### buyers (sample)

```json
[
  {
    "id": 1,
    "name": "Airedale NHS Foundation Trust",
    "entity_id": 1,
    "match_status": "matched",
    "match_confidence": "1.00",
    "match_attempted_at": "2026-01-02T07:25:11.895Z",
    "manually_verified": false,
    "official_website": "http://www.airedale-trust.nhs.uk/",
    "spending_data_url": "https://www.airedale-trust.nhs.uk/about-us/corporate-information-and-publications/finance-and-information",
    "missing_data_note": "Complete data",
    "verified_via": "https://www.england.nhs.uk/publication/airedale-nhs-foundation-trust/",
    "created_at": "2026-01-02T07:25:11.820Z",
    "updated_at": "2026-01-02T07:25:11.820Z"
  },
  {
    "id": 2,
    "name": "Alder Hey Children's NHS Foundation Trust",
    "entity_id": 2,
    "match_status": "matched",
    "match_confidence": "1.00",
    "match_attempted_at": "2026-01-02T07:25:11.902Z",
    "manually_verified": false,
    "official_website": "https://alderhey.nhs.uk/",
    "spending_data_url": "https://www.alderhey.nhs.uk/spend-over-25000/",
    "missing_data_note": "2016 data missing",
    "verified_via": "https://www.england.nhs.uk/publication/alder-hey-childrens-nhs-foundation-trust/#heading-4",
    "created_at": "2026-01-02T07:25:11.820Z",
    "updated_at": "2026-01-02T07:25:11.820Z"
  },
  {
    "id": 3,
    "name": "Ashford and St Peter's Hospitals NHS Foundation Trust",
    "entity_id": 3,
    "match_status": "matched",
    "match_confidence": "1.00",
    "match_attempted_at": "2026-01-02T07:25:11.907Z",
    "manually_verified": false,
    "official_website": "http://www.ashfordstpeters.nhs.uk/",
    "spending_data_url": "https://www.ashfordstpeters.info/foi/expenditure-over-25000",
    "missing_data_note": "Complete data",
    "verified_via": "https://www.england.nhs.uk/publication/ashford-and-st-peters-hospitals-nhs-foundation-trust/#heading-4",
    "created_at": "2026-01-02T07:25:11.820Z",
    "updated_at": "2026-01-02T07:25:11.820Z"
  }
]
```

### spend_entries (sample)

```json
[
  {
    "id": 2431885,
    "asset_id": 16,
    "raw_buyer": "Nottinghamshire Healthcare NHS Foundation Trust",
    "buyer_id": 82,
    "raw_supplier": "COMMUNITY HEALTH PARTNERSHIPS",
    "supplier_id": 97,
    "amount": "40201.83",
    "payment_date": "2016-09-30T16:00:00.000Z",
    "raw_amount": "40201.83",
    "payment_date_raw": "2016-10-01T15:59:17.000Z",
    "source_sheet": "Nottinghamshire Healthcare NHS ",
    "source_row_number": 2166,
    "created_at": "2026-01-04T12:04:04.183Z"
  },
  {
    "id": 2431886,
    "asset_id": 16,
    "raw_buyer": "Nottinghamshire Healthcare NHS Foundation Trust",
    "buyer_id": 82,
    "raw_supplier": "CSE SERVELEC LIMITED",
    "supplier_id": 40828,
    "amount": "32009.76",
    "payment_date": "2016-09-30T16:00:00.000Z",
    "raw_amount": "32009.76",
    "payment_date_raw": "2016-10-01T15:59:17.000Z",
    "source_sheet": "Nottinghamshire Healthcare NHS ",
    "source_row_number": 2167,
    "created_at": "2026-01-04T12:04:04.183Z"
  },
  {
    "id": 2431887,
    "asset_id": 16,
    "raw_buyer": "Nottinghamshire Healthcare NHS Foundation Trust",
    "buyer_id": 82,
    "raw_supplier": "TALENT HUMAN CAPITAL MANAGEMENT LTD",
    "supplier_id": 16312,
    "amount": "31254.12",
    "payment_date": "2016-09-30T16:00:00.000Z",
    "raw_amount": "31254.12",
    "payment_date_raw": "2016-10-01T15:59:17.000Z",
    "source_sheet": "Nottinghamshire Healthcare NHS ",
    "source_row_number": 2168,
    "created_at": "2026-01-04T12:04:04.183Z"
  }
]
```
